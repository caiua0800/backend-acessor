import { Request, Response } from "express";
import fs from "fs";
import { transcribeAudio } from "../services/openaiService";
import {
  downloadWhatsAppMedia,
  sendTextMessage,
} from "../services/whatsappService";
import { cleanupFiles } from "../services/mediaService";
import { pool } from "../db";
import * as orchestrationService from "../services/orchestrationService";
import * as aiService from "../services/aiService";

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

const processAndRespond = async (waId: string) => {
  const buffer = messageBuffers[waId];
  if (!buffer || buffer.messages.length === 0) return;

  buffer.messages.sort((a, b) => a.timestamp - b.timestamp);
  const fullMessage = buffer.messages.map((m) => m.content).join(". ");
  const userName = buffer.userName;

  delete messageBuffers[waId];

  try {
    const userRes = await pool.query(
      `SELECT u.id, u.full_name, uc.* FROM users u
         LEFT JOIN user_configs uc ON u.id = uc.user_id
         WHERE u.phone_number = $1`,
      [waId]
    );

    const dbConfig = userRes.rows.length > 0 ? userRes.rows[0] : {};

    const userConfig = {
      agent_nickname: dbConfig.agent_nickname || "Acessor",
      agent_gender: dbConfig.agent_gender || "Masculino",
      agent_personality: dbConfig.agent_personality || ["Amigo", "Eficiente"],
      user_nickname: userName,
      full_name: userName,
      ai_send_audio: dbConfig.ai_send_audio,
      agent_voice_id: dbConfig.agent_voice_id,
      timezone: dbConfig.timezone || "America/Sao_Paulo",
      language: dbConfig.language || "Português (Brasil)",
    };

    const context = { waId, fullMessage, userName, userConfig };

    console.log(`Mensagem do usuário: ${fullMessage}`);

    const finalResponse = await orchestrationService.processAndOrchestrate(
      context
    );

    console.log(`Mensagem do agente: ${finalResponse}`);

    await sendTextMessage(waId, finalResponse, {
      userConfig: userConfig,
      userOriginalMessage: fullMessage,
    });
  } catch (error: any) {
    try {
      await sendTextMessage(
        waId,
        "*Desculpe*, houve um erro grave na nossa central. Tente novamente mais tarde."
      );
    } catch (e) {}
  }
};

export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
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
        const audioPath = await downloadWhatsAppMedia(
          message.audio.id || message.audio.url
        );
        filesToCleanup.push(audioPath);
        textContent = await transcribeAudio(audioPath);
      } else if (type === "document") {
        const mime = message.document.mime_type;
        const fileName = message.document.filename;

        if (
          mime.includes("csv") ||
          mime.includes("text") ||
          fileName.endsWith(".csv")
        ) {
          const docPath = await downloadWhatsAppMedia(
            message.document.id || message.document.url
          );
          filesToCleanup.push(docPath);
          const fileContent = fs.readFileSync(docPath, "utf-8");
          textContent = `[ARQUIVO IMPORTADO: ${fileName}]\n${fileContent}`;
        } else {
          textContent = `Enviei um arquivo: ${fileName} (Ainda não sei ler este formato)`;
        }
      } else if (type === "image") {
        const imagePath = await downloadWhatsAppMedia(
          message.image.id || message.image.url
        );
        filesToCleanup.push(imagePath);
        const caption = message.image.caption || "";

        const imageDescription = await aiService.describeImage(
          imagePath,
          "Descreva esta imagem detalhadamente para fins financeiros ou organizacionais. Se for uma tabela ou recibo, extraia os dados."
        );

        textContent = `[IMAGEM ENVIADA: ${caption}]\nCONTEÚDO DA IMAGEM: ${imageDescription}`;
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

      messageBuffers[waId].timer = setTimeout(() => {
        processAndRespond(waId);
      }, 2000);
    }
  } catch (error: any) {
    console.error("Erro no processamento do Webhook:", error.message);
  }
};