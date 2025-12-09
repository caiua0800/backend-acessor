// src/services/vaultService.ts

import { pool } from "../db";
import { encryptData, decryptData } from "../utils/cryptoUtils"; // Importe o utilitário

interface AnnotationData {
  title: string;
  category: string;
  content: object;
}

const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0) throw new Error("Usuário não encontrado");
  return res.rows[0].id;
};

// 1. SALVAR (COM CRIPTOGRAFIA)
export const saveAnnotation = async (
  whatsappId: string,
  data: AnnotationData
) => {
  const userId = await getUserId(whatsappId);
  const titleLower = data.title.trim();

  // CRIPTOGRAFA O CONTEÚDO AQUI
  // O banco vai salvar um JSON assim: { "encrypted": "iv:hex..." }
  const encryptedContent = { encrypted: encryptData(data.content) };

  const check = await pool.query(
    "SELECT id FROM user_annotations WHERE user_id = $1 AND title ILIKE $2",
    [userId, titleLower]
  );

  if (check.rows.length > 0) {
    // Atualiza
    const res = await pool.query(
      `UPDATE user_annotations 
       SET content_json = $1, updated_at = NOW(), category = $2
       WHERE id = $3
       RETURNING *`,
      [encryptedContent, data.category, check.rows[0].id]
    );
    return { action: "updated", item: res.rows[0] };
  } else {
    // Cria novo
    const res = await pool.query(
      `INSERT INTO user_annotations (user_id, title, category, content_json)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, data.title, data.category, encryptedContent]
    );
    return { action: "created", item: res.rows[0] };
  }
};

// 2. BUSCAR (COM DESCRIPTOGRAFIA)
export const searchAnnotations = async (whatsappId: string, query: string) => {
  const userId = await getUserId(whatsappId);
  const term = `%${query.trim()}%`;

  // Busca APENAS por Título ou Categoria (Conteúdo está criptografado e ilegível para o SQL)
  const res = await pool.query(
    `SELECT title, category, content_json 
     FROM user_annotations 
     WHERE user_id = $1 
     AND (
        title ILIKE $2 
        OR category ILIKE $2
     )
     LIMIT 5`,
    [userId, term]
  );

  // Descriptografa os resultados antes de devolver
  const decryptedRows = res.rows.map((row) => {
    // Verifica se o JSON tem a chave "encrypted"
    if (row.content_json && row.content_json.encrypted) {
      return {
        ...row,
        content_json: decryptData(row.content_json.encrypted),
      };
    }
    // Legado (caso tenha dados antigos sem criptografia, retorna normal)
    return row;
  });

  return decryptedRows;
};

// ... (deleteAnnotation e listAllAnnotations continuam iguais, pois não leem o conteúdo)
export const deleteAnnotation = async (whatsappId: string, title: string) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "DELETE FROM user_annotations WHERE user_id = $1 AND title ILIKE $2",
    [userId, `%${title.trim()}%`]
  );
  return (res.rowCount ?? 0) > 0;
};

export const listAllAnnotations = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "SELECT title, category FROM user_annotations WHERE user_id = $1 ORDER BY category, title",
    [userId]
  );
  return res.rows;
};
