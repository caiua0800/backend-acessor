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

const sendAudioMessage = async (recipientWaId: string, filePath: string) => {
  const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));
  // CRÍTICO: O MIME Type deve ser audio/ogg
  form.append("type", "audio/ogg");
  form.append("messaging_product", "whatsapp");

  try {
    // 1. Upload do arquivo
    const uploadRes = await axios.post(url, form, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        ...form.getHeaders(),
      },
    });

    const mediaId = uploadRes.data.id;

    // 2. Envio da mensagem de áudio (Referenciando o ID)
    await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: recipientWaId,
        type: "audio",
        audio: { id: mediaId }, // Sem caption, sem nome de arquivo
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  } finally {
    // Limpeza (sempre garantir que o arquivo no servidor seja deletado)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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

    // --- LÓGICA DE DECISÃO DE ÁUDIO ---
    if (options?.userConfig?.ai_send_audio) {
      const wordCount = messageText.split(/\s+/).length;
      const userMsg = options.userOriginalMessage?.toLowerCase() || "";

      // CORREÇÃO: Regex mais agressiva para detectar pedido de texto
      // Pega: "manda escrito", "quero ler", "em texto", "escreve", "escrito por favor"
      const askedForText = userMsg.match(
        /(escreva|escreve|escrito|texto|listar|lista|leia|ler|lendo)/i
      );

      const isListResponse = (messageText.match(/•|- /g) || []).length > 2;

      // Só manda áudio se for curto, se não for lista e se o usuário NÃO pediu texto
      if (wordCount <= 70 && !askedForText && !isListResponse) {
        shouldSendAudio = true;
      }
    }

    if (shouldSendAudio) {
      console.log(`🎙️ Decisão: Enviar ÁUDIO para ${recipientWaId}`);
      const speechText = await aiService.normalizeForSpeech(messageText);
      const voiceId = options?.userConfig?.agent_voice_id || DEFAULT_VOICE_ID;
      const audioPath = await elevenLabsService.generateAudio(
        speechText,
        voiceId
      );
      await sendAudioMessage(recipientWaId, audioPath);
    } else {
      const payload = {
        messaging_product: "whatsapp",
        to: recipientWaId,
        type: "text",
        text: { preview_url: false, body: messageText },
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

const convertAudioToOggOpus = (inputPath: string): Promise<string> => {
  const outputPath = path.join("uploads", `${uuidv4()}.ogg`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat("ogg") // Formato Ogg
      .audioCodec("libopus") // Codec Opus (CRÍTICO para WhatsApp)
      .on("error", (err) => {
        console.error("❌ FFmpeg Erro na Transcodificação:", err.message);
        reject(new Error("FFmpeg falhou ao converter áudio."));
      })
      .on("end", () => {
        // Limpa o arquivo MP3 original
        fs.unlinkSync(inputPath);
        resolve(outputPath);
      })
      .save(outputPath);
  });
};

export const downloadWhatsAppMedia = async (
  mediaIdOrUrl: string
): Promise<string> => {
  try {
    if (!WHATSAPP_TOKEN) throw new Error("WHATSAPP_TOKEN não definido.");
    const response = await axios.get(mediaIdOrUrl, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      responseType: "arraybuffer",
    });
    const fileName = `${uuidv4()}.ogg`;
    const filePath = path.join("uploads", fileName);
    if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
    fs.writeFileSync(filePath, response.data);
    return filePath;
  } catch (error: any) {
    throw new Error("Falha no download da mídia");
  }
};
