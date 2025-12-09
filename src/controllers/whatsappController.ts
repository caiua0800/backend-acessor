import { Request, Response } from "express";
import axios from "axios";
import { transcribeAudio } from "../services/openaiService";
import { downloadWhatsAppMedia } from "../services/whatsappService";
import { cleanupFiles } from "../services/mediaService";
import { pool } from "../db";
import * as orchestrationService from "../services/orchestrationService";
import * as whatsappService from "../services/whatsappService";

// --- FUNÇÃO DE NORMALIZAÇÃO DE TELEFONE ---
const normalizePhoneNumber = (phone: string): string => {
  let cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.startsWith("55") && cleanPhone.length === 12) {
    const countryCode = cleanPhone.substring(0, 2);
    const areaCode = cleanPhone.substring(2, 4);
    const number = cleanPhone.substring(4);
    return `${countryCode}${areaCode}9${number}`;
  }
  return cleanPhone;
};

// --- INTERFACES PARA O BUFFER ---
interface BufferedMessage {
  content: string;
  timestamp: number;
}

interface UserBuffer {
  timer: NodeJS.Timeout | null;
  messages: BufferedMessage[];
  userName: string;
}

const messageBuffers: Record<string, UserBuffer> = {};

// --- ORQUESTRADOR LOCAL ---
const processAndRespond = async (waId: string) => {
  const buffer = messageBuffers[waId];
  if (!buffer || buffer.messages.length === 0) return;

  buffer.messages.sort((a, b) => a.timestamp - b.timestamp);
  const fullMessage = buffer.messages.map((m) => m.content).join(". ");
  const userName = buffer.userName;

  console.log(`🧠 Processando mensagem final (${waId}): "${fullMessage}"`);
  delete messageBuffers[waId];

  try {
    // Busca dados do usuário e configurações
    const userRes = await pool.query(
      `SELECT u.id, u.full_name, uc.* 
         FROM users u
         LEFT JOIN user_configs uc ON u.id = uc.user_id
         WHERE u.phone_number = $1`,
      [waId]
    );

    const dbConfig = userRes.rows.length > 0 ? userRes.rows[0] : {};

    // Mapeia usando as colunas corretas do seu banco
    const userConfig = {
      agent_nickname: dbConfig.agent_nickname || "Acessor",
      agent_gender: dbConfig.agent_gender || "Masculino",
      agent_personality: dbConfig.agent_personality || ["Amigo", "Eficiente"],
      user_nickname: userName,
      full_name: userName,

      // --- CORREÇÃO AQUI ---
      ai_send_audio: dbConfig.ai_send_audio, // Nome correto da coluna
      agent_voice_id: dbConfig.agent_voice_id, // Nome correto da coluna
    };

    const context = { waId, fullMessage, userName, userConfig };

    // Processa a resposta
    const finalResponse = await orchestrationService.processAndOrchestrate(
      context
    );

    // Envia a resposta (Passando o userConfig para decidir entre áudio/texto)
    await whatsappService.sendTextMessage(waId, finalResponse, {
      userConfig: userConfig,
      userOriginalMessage: fullMessage,
    });

    console.log(`✅ Resposta final enviada para ${waId}.`);
  } catch (error: any) {
    console.error("❌ Erro no processamento:", error.message);
    try {
      await whatsappService.sendTextMessage(
        waId,
        "*Desculpe*, houve um erro grave na nossa central. Tente novamente mais tarde."
      );
    } catch (e) {}
  }
};

// ... (Resto do arquivo verifyWebhook e processWebhook continua igual)
export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
};

export const processWebhook = async (req: Request, res: Response) => {
  res.sendStatus(200);

  try {
    const body = req.body;

    if (
      body.object &&
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      const message = body.entry[0].changes[0].value.messages[0];
      const contact = body.entry[0].changes[0].value.contacts[0];

      const originalWaId = contact.wa_id;
      const waId = normalizePhoneNumber(originalWaId);

      // Atualiza Janela de 24h
      await pool.query(
        "UPDATE users SET last_interaction_at = NOW() WHERE phone_number = $1",
        [waId]
      );

      const name = contact.profile.name;
      const type = message.type;
      const messageTimestamp = parseInt(message.timestamp);

      let textContent = "";
      let filesToCleanup: string[] = [];

      if (type === "text") {
        textContent = message.text.body;
      } else if (type === "audio") {
        console.log("🎤 Áudio recebido. Transcrevendo...");
        const audioPath = await downloadWhatsAppMedia(message.audio.url);
        filesToCleanup.push(audioPath);
        textContent = await transcribeAudio(audioPath);
        console.log(`📝 Transcrição: ${textContent}`);
      }

      if (!textContent) {
        cleanupFiles(filesToCleanup);
        return;
      }

      if (!messageBuffers[waId]) {
        messageBuffers[waId] = { timer: null, messages: [], userName: name };
      }

      messageBuffers[waId].messages.push({
        content: textContent,
        timestamp: messageTimestamp,
      });

      if (messageBuffers[waId].timer) {
        clearTimeout(messageBuffers[waId].timer!);
      }

      if (filesToCleanup.length > 0) {
        cleanupFiles(filesToCleanup);
      }

      console.log(`⏳ Mensagem adicionada. Timer resetado (1s).`);
      messageBuffers[waId].timer = setTimeout(() => {
        processAndRespond(waId);
      }, 1000);
    }
  } catch (error: any) {
    console.error("Erro no processamento do Webhook:", error.message);
  }
};
