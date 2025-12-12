import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import { v4 as uuidv4 } from "uuid";
import * as elevenLabsService from "./elevenLabsService";
import * as aiService from "./aiService";
import ffmpeg from "fluent-ffmpeg";

const WHATSAPP_API_URL =
  process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v19.0";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const DEFAULT_VOICE_ID = process.env.DEFAULT_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

// Helper para descobrir a extensão baseada no Mime Type
const getExtension = (mimeType: string): string => {
  if (mimeType.includes("csv")) return "csv";
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("image/jpeg")) return "jpg";
  if (mimeType.includes("image/png")) return "png";
  if (mimeType.includes("audio/ogg")) return "ogg";
  if (mimeType.includes("audio/mpeg") || mimeType.includes("audio/mp3"))
    return "mp3";
  if (mimeType.includes("text/plain")) return "txt";
  return "bin"; // Fallback
};

const sendAudioMessage = async (recipientWaId: string, filePath: string) => {
  const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));
  form.append("type", "audio/ogg");
  form.append("messaging_product", "whatsapp");

  try {
    const uploadRes = await axios.post(url, form, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        ...form.getHeaders(),
      },
    });

    const mediaId = uploadRes.data.id;

    await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: recipientWaId,
        type: "audio",
        audio: { id: mediaId },
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  } finally {
    try {
      if (fs.existsSync(filePath)) await fs.promises.unlink(filePath);
    } catch (e) {
      console.error("Erro ao deletar arquivo temp:", e);
    }
  }
};

export const sendTextMessage = async (
  recipientWaId: string,
  messageText: string,
  options?: { userConfig?: any; userOriginalMessage?: string }
): Promise<void> => {
  if (!WHATSAPP_API_URL || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("❌ Variáveis de ambiente do WhatsApp não configuradas.");
    return;
  }

  try {
    let shouldSendAudio = false;
    const hasLink =
      messageText.includes("http://") || messageText.includes("https://");

    if (options?.userConfig?.ai_send_audio) {
      const wordCount = messageText.split(/\s+/).length;
      const userMsg = options.userOriginalMessage?.toLowerCase() || "";

      const askedForText = userMsg.match(
        /(escreva|escreve|escrito|texto|listar|lista|leia|ler|lendo)/i
      );

      const isListResponse = (messageText.match(/•|- /g) || []).length > 2;

      var randomNum = Math.random();

      if (
        wordCount <= 70 &&
        !askedForText &&
        !isListResponse &&
        randomNum > 0.7
      ) {
        shouldSendAudio = true;
      }
    }

    if (shouldSendAudio) {
      console.log(`🎙️ Decisão: Enviar ÁUDIO para ${recipientWaId}`);

      const userLang = options?.userConfig?.language || "Português (Brasil)";

      const speechText = await aiService.normalizeForSpeech(
        messageText,
        userLang
      );
      const voiceId = options?.userConfig?.agent_voice_id || DEFAULT_VOICE_ID;
      const audioPath = await elevenLabsService.generateAudio(
        speechText,
        voiceId
      );
      await sendAudioMessage(recipientWaId, audioPath);

      if (hasLink) {
        console.log(`🔗 Link detectado. Enviando complemento de TEXTO.`);
        const payload = {
          messaging_product: "whatsapp",
          to: recipientWaId,
          type: "text",
          text: { preview_url: true, body: messageText },
        };
        await axios.post(
          `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      }
    } else {
      const payload = {
        messaging_product: "whatsapp",
        to: recipientWaId,
        type: "text",
        text: { preview_url: true, body: messageText },
      };

      await axios.post(
        `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log(`💬 Decisão: Enviar TEXTO para ${recipientWaId}`);
    }
  } catch (error: any) {
    console.error(
      "Erro ao enviar mensagem:",
      error.response?.data || error.message
    );
    if (
      error.message.includes("ElevenLabs") ||
      error.message.includes("upload")
    ) {
      console.log("⚠️ Fallback: Enviando texto devido a erro no áudio.");
      await sendTextMessage(recipientWaId, messageText);
    }
  }
};

// --- FUNÇÃO CORRIGIDA DE DOWNLOAD ---
export const downloadWhatsAppMedia = async (
  mediaIdOrUrl: string
): Promise<string> => {
  try {
    if (!WHATSAPP_TOKEN) throw new Error("WHATSAPP_TOKEN não definido.");

    // Se não for URL completa, assumimos que é um ID e buscamos a URL na Graph API
    let mediaUrl = mediaIdOrUrl;
    let mimeType = "";

    if (!mediaIdOrUrl.startsWith("http")) {
      try {
        const metadataRes = await axios.get(
          `${WHATSAPP_API_URL}/${mediaIdOrUrl}`,
          {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
          }
        );
        mediaUrl = metadataRes.data.url;
        mimeType = metadataRes.data.mime_type;
      } catch (err) {
        throw new Error("Falha ao recuperar URL da mídia pelo ID.");
      }
    }

    // Faz o download do binário
    const response = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      responseType: "arraybuffer",
    });

    // Define extensão correta (evita salvar CSV como .ogg)
    const ext = getExtension(mimeType || "bin");
    const fileName = `${uuidv4()}.${ext}`;
    const filePath = path.join("uploads", fileName);

    if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
    fs.writeFileSync(filePath, response.data);

    return filePath;
  } catch (error: any) {
    console.error("Erro no download de mídia:", error.message);
    throw new Error("Falha no download da mídia");
  }
};
