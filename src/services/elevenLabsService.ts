import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const API_KEY = process.env.ELEVEN_LABS_API_KEY;
const BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export const generateAudio = async (
  text: string,
  voiceId: string
): Promise<string> => {
  if (!API_KEY) throw new Error("ELEVENLABS_API_KEY não configurada.");

  // CRÍTICO: Mudar a extensão para .ogg
  const fileName = `${uuidv4()}.ogg`;
  const filePath = path.join("uploads", fileName);

  try {
    const response = await axios.post(
      `${BASE_URL}/${voiceId}`,
      {
        text: text,
        model_id: "eleven_multilingual_v2", // Melhor para PT-BR
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
        // CRÍTICO: Adicionar a propriedade output_format para OGG/Opus
        output_format: "ogg_48000_192",
      },
      {
        headers: {
          "xi-api-key": API_KEY,
          "Content-Type": "application/json",
          // Sugerir ao ElevenLabs que queremos OGG
          Accept: "audio/ogg",
        },
        responseType: "arraybuffer",
      }
    );

    if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
    fs.writeFileSync(filePath, response.data);

    // Retorna o caminho do arquivo OGG
    return filePath;
  } catch (error: any) {
    console.error("❌ Erro ElevenLabs:", error.response?.data || error.message);
    throw new Error("Falha ao gerar áudio.");
  }
};
