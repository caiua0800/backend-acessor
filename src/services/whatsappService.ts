import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import { v4 as uuidv4 } from "uuid";
import * as elevenLabsService from "./elevenLabsService";
import * as aiService from "./aiService";
// import ffmpeg from "fluent-ffmpeg"; // FFmpeg não é mais necessário aqui

const WHATSAPP_API_URL =
  process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v19.0";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const DEFAULT_VOICE_ID = process.env.DEFAULT_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

// --- FUNÇÃO AUXILIAR: CONVERTER MP3/MPEG PARA OGG OPUS ---
// REMOVIDA: Não precisamos mais de transcodificação se o ElevenLabs retornar OGG/Opus.

// --- FUNÇÃO AUXILIAR PARA ENVIAR ÁUDIO (USANDO OGG/OPUS) ---
const sendAudioMessage = async (recipientWaId: string, filePath: string) => {
  const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));
  // MIME Type CORRETO para áudio de voz
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

// --- FUNÇÃO INTELIGENTE DE ENVIO ---
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

      // Pega: "manda escrito", "quero ler", "em texto", "escreve", "escrito"
      const askedForText = userMsg.match(
        /(escreva|escreve|escrito|texto|listar|lista|leia|ler|lendo|mande escrito)/i
      );

      // Vê se a resposta tem muitos bullet points (lista)
      const isListResponse = (messageText.match(/•|- /g) || []).length > 2;

      if (wordCount <= 70 && !askedForText && !isListResponse) {
        shouldSendAudio = true;
      }
    }

    if (shouldSendAudio) {
      console.log(`🎙️ Decisão: Enviar ÁUDIO para ${recipientWaId}`);

      const speechText = await aiService.normalizeForSpeech(messageText);
      const voiceId = options?.userConfig?.agent_voice_id || DEFAULT_VOICE_ID;

      // Chama a função que agora retorna OGG/Opus
      const oggPath = await elevenLabsService.generateAudio(
        speechText,
        voiceId
      );

      // Apenas envia o arquivo OGG/Opus diretamente
      await sendAudioMessage(recipientWaId, oggPath);
    } else {
      // --- ENVIO PADRÃO DE TEXTO ---
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
    // O Fallback agora só precisa checar se houve erro no ElevenLabs
    if (error.message.includes("Falha ao gerar áudio.")) {
      console.log("⚠️ Fallback: Enviando texto devido a erro na API de áudio.");
      // Chama recursivo sem options para forçar o envio de texto
      await sendTextMessage(recipientWaId, messageText);
    }
  }
};

// ... (Mantenha o downloadWhatsAppMedia igual)
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
