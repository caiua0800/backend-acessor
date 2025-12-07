import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// --- CONFIGURAÇÕES DE ENVIO ---
// Configure estas variáveis de ambiente no seu .env
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v19.0"; // URL base
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; 
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID; // Seu "798010456726495"

// --- 1. FUNÇÃO DE ENVIO DE TEXTO (CORREÇÃO FINAL) ---

/**
 * Envia uma mensagem de texto simples para um destinatário usando a API do WhatsApp Business Cloud.
 * @param recipientWaId O número de telefone do destinatário (ID do WhatsApp).
 * @param messageText O conteúdo da mensagem a ser enviada.
 */
export const sendTextMessage = async (
  recipientWaId: string,
  messageText: string
): Promise<void> => {
  if (!WHATSAPP_API_URL || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("❌ Variáveis de ambiente do WhatsApp não configuradas para envio.");
    return;
  }

  try {
    const payload = {
      messaging_product: "whatsapp",
      to: recipientWaId,
      type: "text",
      text: {
        preview_url: false,
        body: messageText,
      },
    };

    // Endpoint de envio: https://graph.facebook.com/v19.0/PHONE_NUMBER_ID/messages
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
    
    console.log(`💬 Mensagem enviada para ${recipientWaId}: ${messageText.substring(0, 50)}...`);

  } catch (error: any) {
    console.error("Erro ao enviar mensagem pelo WhatsApp:", error.response?.data || error.message);
    // Não lança exceção para não quebrar a execução superior.
  }
};


// --- 2. FUNÇÃO DE DOWNLOAD DE MÍDIA (CÓDIGO ORIGINAL) ---

/**
 * Baixa a mídia do WhatsApp (como áudio) usando o Token da API.
 * @param mediaIdOrUrl A URL de download da mídia fornecida pelo webhook do WhatsApp.
 * @returns O caminho local do arquivo baixado.
 */
export const downloadWhatsAppMedia = async (
  mediaIdOrUrl: string
): Promise<string> => {
  try {
    if (!WHATSAPP_TOKEN) throw new Error("WHATSAPP_TOKEN não definido.");

    // A URL de download da mídia já vem na notificação do webhook
    const response = await axios.get(mediaIdOrUrl, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      responseType: "arraybuffer",
    });

    const fileName = `${uuidv4()}.ogg`;
    const filePath = path.join("uploads", fileName);

    // Certifique-se de que a pasta 'uploads' existe antes de escrever
    if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
    
    fs.writeFileSync(filePath, response.data);

    return filePath;
  } catch (error: any) {
    console.error("Erro ao baixar mídia do WhatsApp:", error.message);
    throw new Error("Falha no download da mídia");
  }
};