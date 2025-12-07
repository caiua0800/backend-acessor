import ffmpeg from "fluent-ffmpeg";
import fs from "fs";

export const convertToOpus = (
  inputPath: string,
  outputPath: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat("ogg")
      .audioCodec("libopus")
      .audioChannels(1) // <--- O SEGREDO ESTÁ AQUI (Força Mono)
      .audioFrequency(48000) // (Opcional) Mantém qualidade alta
      .on("end", () => {
        resolve(outputPath);
      })
      .on("error", (err) => {
        console.error("Erro na conversão FFmpeg:", err);
        reject(err);
      })
      .save(outputPath);
  });
};

export const cleanupFiles = (paths: string[]) => {
  paths.forEach((path) => {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path); // Deleta síncrono para garantir
    }
  });
};
