import { pool } from "../db";

const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0) throw new Error("Usuário não encontrado.");
  return res.rows[0].id;
};

// =================================================================
// 🤖 FUNÇÕES PARA O BOT (MANTIDAS)
// =================================================================

export const createIdea = async (
  whatsappId: string,
  content: string,
  tags: string[] = []
) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    `INSERT INTO ideas (user_id, idea_content, tags)
         VALUES ($1, $2, $3)
         RETURNING *`,
    [userId, content, tags]
  );
  return res.rows[0];
};

export const listIdeas = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "SELECT id, idea_content, tags, created_at FROM ideas WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return res.rows;
};

export const updateIdea = async (
  whatsappId: string,
  ideaId: string,
  content?: string,
  tags?: string[]
) => {
  const userId = await getUserId(whatsappId);
  const fields = [];
  const values = [];
  let queryIndex = 1;

  if (content) {
    fields.push(`idea_content = $${queryIndex++}`);
    values.push(content);
  }
  if (tags) {
    fields.push(`tags = $${queryIndex++}`);
    values.push(tags);
  }

  if (fields.length === 0) throw new Error("Nada para atualizar.");

  fields.push(`updated_at = NOW()`);
  values.push(ideaId, userId);

  const res = await pool.query(
    `UPDATE ideas SET ${fields.join(
      ", "
    )} WHERE id = $${queryIndex++} AND user_id = $${queryIndex++} RETURNING *`,
    values
  );
  return res.rows[0];
};

export const deleteIdea = async (whatsappId: string, ideaId: string) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "DELETE FROM ideas WHERE id = $1 AND user_id = $2",
    [ideaId, userId]
  );
  const deletedCount = res.rowCount ?? 0;
  return { message: "Ideia apagada.", deleted: deletedCount > 0 };
};

export const deleteAllIdeas = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  await pool.query("DELETE FROM ideas WHERE user_id = $1", [userId]);
  return { message: "Todas as ideias apagadas." };
};

// =================================================================
// 📱 FUNÇÕES PARA A API / CONTROLLER (VIA USER ID)
// =================================================================

export const createIdeaByUserId = async (
  userId: string,
  content: string,
  tags: string[] = []
) => {
  const res = await pool.query(
    `INSERT INTO ideas (user_id, idea_content, tags)
         VALUES ($1, $2, $3)
         RETURNING *`,
    [userId, content, tags]
  );
  return res.rows[0];
};

export const listIdeasByUserId = async (userId: string) => {
  const res = await pool.query(
    "SELECT id, idea_content, tags, created_at FROM ideas WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return res.rows;
};

export const updateIdeaByUserId = async (
  userId: string,
  ideaId: string,
  content?: string,
  tags?: string[]
) => {
  const fields = [];
  const values = [];
  let queryIndex = 1;

  if (content) {
    fields.push(`idea_content = $${queryIndex++}`);
    values.push(content);
  }
  if (tags) {
    fields.push(`tags = $${queryIndex++}`);
    values.push(tags);
  }

  if (fields.length === 0) throw new Error("Nada para atualizar.");

  fields.push(`updated_at = NOW()`);
  values.push(parseInt(ideaId), userId); // Converter ID para int se for SERIAL no banco

  const res = await pool.query(
    `UPDATE ideas SET ${fields.join(
      ", "
    )} WHERE id = $${queryIndex++} AND user_id = $${queryIndex++} RETURNING *`,
    values
  );
  return res.rows[0];
};

export const deleteIdeaByUserId = async (userId: string, ideaId: string) => {
  // Se o ID no banco for integer, faça parseInt(ideaId)
  const res = await pool.query(
    "DELETE FROM ideas WHERE id = $1 AND user_id = $2",
    [parseInt(ideaId), userId]
  );
  const deletedCount = res.rowCount ?? 0;
  return { message: "Ideia apagada.", deleted: deletedCount > 0 };
};

export const deleteAllIdeasByUserId = async (userId: string) => {
  await pool.query("DELETE FROM ideas WHERE user_id = $1", [userId]);
  return { message: "Todas as ideias foram apagadas." };
};
