import { pool } from "../db";

const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0) throw new Error("Usuário não encontrado.");
  return res.rows[0].id;
};

// 1. Criar uma nova ideia
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

// 2. Listar todas as ideias de um usuário
export const listIdeas = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "SELECT id, idea_content, tags, created_at FROM ideas WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return res.rows;
};

// 3. Editar uma ideia (conteúdo ou tags)
export const updateIdea = async (
  whatsappId: string,
  ideaId: string,
  content?: string,
  tags?: string[]
) => {
  const userId = await getUserId(whatsappId);

  // Constrói a query dinamicamente para atualizar apenas os campos fornecidos
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

  if (fields.length === 0) {
    throw new Error("Nenhum conteúdo ou tag fornecido para atualização.");
  }

  // Adiciona a atualização do timestamp
  fields.push(`updated_at = NOW()`);

  values.push(ideaId, userId); // Adiciona os valores para o WHERE

  const res = await pool.query(
    `UPDATE ideas SET ${fields.join(
      ", "
    )} WHERE id = $${queryIndex++} AND user_id = $${queryIndex++} RETURNING *`,
    values
  );
  return res.rows[0];
};

// 4. Apagar uma ideia específica
export const deleteIdea = async (whatsappId: string, ideaId: string) => {
    const userId = await getUserId(whatsappId);
    const res = await pool.query(
      "DELETE FROM ideas WHERE id = $1 AND user_id = $2",
      [ideaId, userId]
    );
    
    // CORREÇÃO APLICADA AQUI:
    // Verifica se rowCount existe e é um número. Se não, considera 0.
    const deletedCount = res.rowCount ?? 0;
  
    return { 
      message: "Ideia apagada com sucesso.", 
      deleted: deletedCount > 0 
    };
  };

// 5. Apagar todas as ideias
export const deleteAllIdeas = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  await pool.query("DELETE FROM ideas WHERE user_id = $1", [userId]);
  return { message: "Todas as suas ideias foram apagadas." };
};
