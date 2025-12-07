import { Request, Response } from "express";
import axios from "axios";
import { transcribeAudio } from "../services/openaiService";
import { downloadWhatsAppMedia } from "../services/whatsappService";
import { cleanupFiles } from "../services/mediaService";
import { pool } from "../db";

// --- FUNÇÃO DE NORMALIZAÇÃO DE TELEFONE ---
const normalizePhoneNumber = (phone: string): string => {
  // Remove qualquer caractere que não seja número
  let cleanPhone = phone.replace(/\D/g, "");

  // Verifica se é um número de celular brasileiro (55 + DDD + Número) sem o 9º dígito
  // 55 (País) + XX (DDD) + 8 dígitos = 12 caracteres
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

// --- O RESTO DO SEU CÓDIGO CONTINUA IGUAL, SÓ USAMOS A NOVA FUNÇÃO ---

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

const sendToN8N = async (waId: string) => {
  const buffer = messageBuffers[waId];
  if (!buffer || buffer.messages.length === 0) return;

  buffer.messages.sort((a, b) => a.timestamp - b.timestamp);

  const finalMessage = buffer.messages.map((m) => m.content).join(". ");
  const userName = buffer.userName;

  console.log(
    `📤 Enviando buffer ordenado para n8n (${waId}): "${finalMessage}"`
  );

  delete messageBuffers[waId];

  try {
    const userRes = await pool.query(
      `SELECT u.id, u.full_name, uc.* 
         FROM users u
         LEFT JOIN user_configs uc ON u.id = uc.user_id
         WHERE u.phone_number = $1`,
      [waId] // waId aqui já está normalizado
    );

    let userConfig = {};
    if (userRes.rows.length > 0) {
      userConfig = userRes.rows[0];
    }

    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nUrl) {
      console.error("❌ N8N_WEBHOOK_URL não definido no .env");
      return;
    }

    const payload = {
      wa_id: waId,
      user_name: userName,
      user_message: finalMessage,
      timestamp: Date.now(),
      config: userConfig,
    };

    await axios.post(n8nUrl, payload);
  } catch (error: any) {
    console.error("❌ Erro ao enviar para n8n:", error.message);
  }
};

export const verifyWebhook = (req: Request, res: Response) => {
  // ... (código igual)
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

      // --- AQUI A MÁGICA ACONTECE ---
      const originalWaId = contact.wa_id;
      const waId = normalizePhoneNumber(originalWaId); // Normaliza o número
      // ---------------------------------

      const name = contact.profile.name;
      const type = message.type;
      const messageTimestamp = parseInt(message.timestamp);

      let textContent = "";

      if (type === "text") {
        textContent = message.text.body;
      } else if (type === "audio") {
        console.log("🎤 Áudio recebido. Transcrevendo...");
        const audioPath = await downloadWhatsAppMedia(message.audio.url);
        textContent = await transcribeAudio(audioPath);
        cleanupFiles([audioPath]);
        console.log(`📝 Transcrição: ${textContent}`);
      }

      if (!textContent) return;

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

      console.log(`⏳ Mensagem adicionada. Timer resetado (6s).`);
      messageBuffers[waId].timer = setTimeout(() => {
        sendToN8N(waId); // O waId enviado já está corrigido
      }, 1000);
    }
  } catch (error: any) {
    console.error("Erro no processamento do Webhook:", error.message);
  }
};
