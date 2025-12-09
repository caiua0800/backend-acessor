import { google } from "googleapis";
import { pool } from "../db";

// Pega a chave do arquivo .env
const YOUTUBE_API_KEY = process.env.GOOGLE_API_KEY;

if (!YOUTUBE_API_KEY) {
  console.warn(
    "⚠️ GOOGLE_API_KEY não configurada. A busca de vídeos não funcionará."
  );
}

const youtube = google.youtube({
  version: "v3",
  auth: YOUTUBE_API_KEY, // Autenticação simples via API Key
});

export const getExerciseVideo = async (
  exerciseName: string
): Promise<string | null> => {
  if (!YOUTUBE_API_KEY) return null;

  // Limpeza do termo (remove números e repetições para buscar melhor)
  // Ex: "Supino Reto 4x10" vira "Supino Reto"
  const term = exerciseName
    .replace(/[0-9].*/, "")
    .trim()
    .toLowerCase();

  // 1. TENTA ACHAR NO CACHE (BANCO DE DADOS)
  const dbRes = await pool.query(
    "SELECT video_url FROM exercise_videos WHERE search_term = $1",
    [term]
  );

  if (dbRes.rows.length > 0) {
    console.log(`🎥 [YOUTUBE CACHE] Vídeo encontrado para: ${term}`);
    return dbRes.rows[0].video_url;
  }

  // 2. SE NÃO ACHAR, BUSCA NA API DO YOUTUBE
  try {
    console.log(`📡 [YOUTUBE API] Buscando novo vídeo para: ${term}`);

    const response = await youtube.search.list({
      part: ["snippet"],
      q: `execução correta exercicio ${term}`, // Palavras-chave para melhorar qualidade
      type: ["video"],
      videoDuration: "short", // Prioriza vídeos curtos (< 4 min)
      maxResults: 1,
      relevanceLanguage: "pt",
      regionCode: "BR",
    });

    const items = response.data.items;

    if (items && items.length > 0) {
      const videoId = items[0].id?.videoId;
      const title = items[0].snippet?.title || "Exercício";
      const url = `https://www.youtube.com/watch?v=${videoId}`;

      // 3. SALVA NO BANCO PARA A PRÓXIMA VEZ (CACHE)
      // O 'ON CONFLICT' garante que não duplique se der erro de concorrência
      await pool.query(
        "INSERT INTO exercise_videos (search_term, video_url, video_title) VALUES ($1, $2, $3) ON CONFLICT (search_term) DO NOTHING",
        [term, url, title]
      );

      return url;
    }

    return null; // Não achou
  } catch (error: any) {
    console.error("❌ Erro na API do YouTube:", error.message);
    // Não lança erro (throw) para não travar o fluxo do treino.
    // Se falhar o vídeo, o usuário ainda recebe o treino em texto.
    return null;
  }
};
