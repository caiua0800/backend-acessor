import { Request, Response } from "express";
import axios from "axios";
import { transcribeAudio } from "../services/openaiService";
import { downloadWhatsAppMedia } from "../services/whatsappService"; // Mantenha este import se for onde está o download
import { cleanupFiles } from "../services/mediaService";
import { pool } from "../db";
import * as orchestrationService from '../services/orchestrationService';
import * as whatsappService from "../services/whatsappService" // Supondo que sendTextMessage está aqui

// --- FUNÇÃO DE NORMALIZAÇÃO DE TELEFONE ---
const normalizePhoneNumber = (phone: string): string => {
  // Remove qualquer caractere que não seja número
  let cleanPhone = phone.replace(/\D/g, "");

  // Verifica se é um número de celular brasileiro (55 + DDD + Número) sem o 9º dígito
  if (cleanPhone.startsWith("55") && cleanPhone.length === 12) {
    const countryCode = cleanPhone.substring(0, 2);
    const areaCode = cleanPhone.substring(2, 4);
    const number = cleanPhone.substring(4);

    // Adiciona o '9' e reconstrói o número
    return `${countryCode}${areaCode}9${number}`;
  }

  // Se não se encaixa na regra, retorna o número limpo original
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

// --- ORQUESTRADOR LOCAL (SUBSTITUIU A CHAMADA AO N8N) ---
const processAndRespond = async (waId: string) => {
  const buffer = messageBuffers[waId];
  if (!buffer || buffer.messages.length === 0) return;

  // 1. MONTA A MENSAGEM FINAL E LIMPA O BUFFER
  buffer.messages.sort((a, b) => a.timestamp - b.timestamp);
  const fullMessage = buffer.messages.map((m) => m.content).join(". ");
  const userName = buffer.userName;

  console.log(`🧠 Processando mensagem final (${waId}): "${fullMessage}"`);
  delete messageBuffers[waId];

  try {
    // 2. BUSCA CONFIGURAÇÕES DO USUÁRIO
    const userRes = await pool.query(
      `SELECT u.id, u.full_name, uc.* 
         FROM users u
         LEFT JOIN user_configs uc ON u.id = uc.user_id
         WHERE u.phone_number = $1`,
      [waId]
    );

    // Cria o objeto UserConfig para o Orquestrador
    // Se não achar, usa um objeto vazio/default
    const userConfig = userRes.rows.length > 0 ? userRes.rows[0] : {
      agent_nickname: "Acessor",
      agent_gender: "Masculino",
      agent_personality: ["Amigo", "Eficiente"],
      user_nickname: userName,
      full_name: userName,
    };

    const context = { 
        waId, 
        fullMessage, 
        userName, 
        userConfig 
    };
    
    // 3. ORQUESTRAÇÃO LOCAL
    const finalResponse = await orchestrationService.processAndOrchestrate(context);
    
    // 4. ENVIA A RESPOSTA 
    // OBS: O whatsappService.sendTextMessage deve existir e estar implementado
    await whatsappService.sendTextMessage(waId, finalResponse); 

    console.log(`✅ Resposta final enviada para ${waId}.`);

  } catch (error: any) {
    console.error("❌ Erro no processamento e orquestração:", error.message);
    // Tenta enviar uma mensagem de erro ao usuário
    try {
        await whatsappService.sendTextMessage(waId, "*Desculpe*, houve um erro grave na nossa central. Tente novamente mais tarde."); 
    } catch (e) {}
  }
};

// --- ROTAS DO EXPRESS ---

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
  // Responde imediatamente ao WhatsApp para evitar timeouts
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

      // Normaliza o ID para busca e processamento
      const originalWaId = contact.wa_id;
      const waId = normalizePhoneNumber(originalWaId); 

      const name = contact.profile.name;
      const type = message.type;
      const messageTimestamp = parseInt(message.timestamp);

      let textContent = "";
      let filesToCleanup: string[] = [];

      // 1. Processa Áudio/Texto
      if (type === "text") {
        textContent = message.text.body;
      } else if (type === "audio") {
        console.log("🎤 Áudio recebido. Transcrevendo...");
        const audioPath = await downloadWhatsAppMedia(message.audio.url);
        filesToCleanup.push(audioPath); // Adiciona para limpar
        textContent = await transcribeAudio(audioPath);
        console.log(`📝 Transcrição: ${textContent}`);
      }

      if (!textContent) {
        cleanupFiles(filesToCleanup);
        return;
      }

      // 2. Lógica do Buffer (Agrupamento de Mensagens)
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

      // Limpa os arquivos temporários do áudio
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