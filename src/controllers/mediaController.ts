import { Request, Response } from "express";
import path from "path";
import { convertToOpus, cleanupFiles } from "../services/mediaService";

export const convertVoiceNote = async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado." });
  }
  const inputPath = req.file.path;
  const outputPath = path.join("uploads", `${req.file.filename}.ogg`);

  try {
    await convertToOpus(inputPath, outputPath);
    res.download(outputPath, "audio.ogg", () => {
      cleanupFiles([inputPath, outputPath]);
    });
  } catch (error: any) {
    cleanupFiles([inputPath]);
    res.status(500).json({ error: "Erro na conversão: " + error.message });
  }
};
