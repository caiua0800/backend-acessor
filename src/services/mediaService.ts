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
      .audioChannels(1)
      .audioFrequency(48000)
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

// CORREÇÃO: Função assíncrona que não trava o bot
export const cleanupFiles = async (paths: string[]) => {
  for (const path of paths) {
    try {
      await fs.promises.access(path).then(() => fs.promises.unlink(path));
    } catch (e) {
      console.log(`Erro ao limpar os arquivos: ${e}`);
    }
  }
};