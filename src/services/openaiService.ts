import OpenAI from "openai";
import fs from "fs";

// Remova a inicialização global daqui

export const transcribeAudio = async (filePath: string): Promise<string> => {
  try {
    // INICIE AQUI DENTRO
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
      language: "pt",
    });

    return transcription.text;
  } catch (error: any) {
    console.error("Erro no Whisper:", error);
    return "";
  }
};