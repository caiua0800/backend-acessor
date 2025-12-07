import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// Baixa a mídia do WhatsApp usando o Token da API
export const downloadWhatsAppMedia = async (
  mediaIdOrUrl: string
): Promise<string> => {
  try {
    const token = process.env.WHATSAPP_TOKEN;

    // Se o webhook mandar só o ID, precisaria buscar a URL primeiro.
    // Mas geralmente ele manda a URL no campo 'url'.
    // O axios precisa dos headers de autorização.

    const response = await axios.get(mediaIdOrUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: "arraybuffer",
    });

    const fileName = `${uuidv4()}.ogg`;
    const filePath = path.join("uploads", fileName);

    fs.writeFileSync(filePath, response.data);

    return filePath;
  } catch (error: any) {
    console.error("Erro ao baixar mídia do WhatsApp:", error.message);
    throw new Error("Falha no download da mídia");
  }
};
