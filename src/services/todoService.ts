import { pool } from "../db";

const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0) throw new Error("Usuário não encontrado.");
  return res.rows[0].id;
};

export const createTask = async (
  whatsappId: string,
  task: string,
  deadline?: string
) => {
  console.log(`🛠️ [DB INSERT] Task: "${task}"`);
  const userId = await getUserId(whatsappId);
  const deadlineVal = deadline && deadline.trim() !== "" ? deadline : null;

  const res = await pool.query(
    `INSERT INTO todo_items (user_id, task, deadline) VALUES ($1, $2, $3) RETURNING *`,
    [userId, task, deadlineVal]
  );
  return res.rows[0];
};

export const completeTaskByTerm = async (whatsappId: string, term: string) => {
  const userId = await getUserId(whatsappId);
  const searchTerm = `%${term.trim()}%`;

  console.log(`🔍 [DB SEARCH] ILIKE "${searchTerm}" (User: ${userId})`);

  // Tenta encontrar uma tarefa PENDENTE que contenha o termo
  const searchRes = await pool.query(
    `SELECT id, task FROM todo_items 
     WHERE user_id = $1 
     AND done = FALSE 
     AND task ILIKE $2
     LIMIT 1`,
    [userId, searchTerm]
  );

  if (searchRes.rows.length === 0) {
    console.log(`❌ [DB SEARCH] 0 resultados para "${searchTerm}"`);
    return null;
  }

  const taskItem = searchRes.rows[0];
  console.log(`✅ [DB FOUND] ID: ${taskItem.id} | Task: "${taskItem.task}"`);

  const updateRes = await pool.query(
    `UPDATE todo_items SET done = TRUE, done_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
    [taskItem.id]
  );

  return updateRes.rows[0];
};

export const listTasks = async (whatsappId: string, showCompleted = false) => {
  const userId = await getUserId(whatsappId);
  console.log(`📋 [DB LIST] User: ${userId} | ShowCompleted: ${showCompleted}`);

  let query = `SELECT * FROM todo_items WHERE user_id = $1`;
  if (!showCompleted) query += ` AND done = FALSE`;
  else
    query += ` AND (done = FALSE OR (done = TRUE AND done_at > NOW() - INTERVAL '24 HOURS'))`;

  query += ` ORDER BY created_at DESC`;

  const res = await pool.query(query, [userId]);
  console.log(`📋 [DB LIST] Retornou ${res.rowCount} itens.`);
  return res.rows;
};

export const deleteTask = async (whatsappId: string, term: string) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    `DELETE FROM todo_items WHERE user_id = $1 AND task ILIKE $2 RETURNING task`,
    [userId, `%${term.trim()}%`]
  );
  return res.rows[0];
};

export const createTaskByUserId = async (
  userId: string,
  task: string,
  deadline?: string
) => {
  const deadlineVal = deadline && deadline.trim() !== "" ? deadline : null;
  const res = await pool.query(
    `INSERT INTO todo_items (user_id, task, deadline) VALUES ($1, $2, $3) RETURNING *`,
    [userId, task, deadlineVal]
  );
  return res.rows[0];
};

export const listTasksByUserId = async (
  userId: string,
  showCompleted = false
) => {
  let query = `SELECT * FROM todo_items WHERE user_id = $1`;

  if (!showCompleted) {
    query += ` AND done = FALSE`;
  } else {
    // Mostra pendentes + concluídas nas últimas 48h (pra dar tempo de ver que concluiu)
    query += ` AND (done = FALSE OR (done = TRUE AND done_at > NOW() - INTERVAL '48 HOURS'))`;
  }

  query += ` ORDER BY done ASC, deadline ASC NULLS LAST, created_at DESC`;

  const res = await pool.query(query, [userId]);
  return res.rows;
};

// Atualiza status pelo ID (mais preciso para frontend que clicar no botão)
export const updateTaskStatusByUserId = async (
  userId: string,
  taskId: number,
  done: boolean
) => {
  let query;
  // Se marcou como feito: done_at = AGORA
  // Se desmarcou: done_at = NULL
  if (done) {
    query = `UPDATE todo_items SET done = TRUE, done_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`;
  } else {
    query = `UPDATE todo_items SET done = FALSE, done_at = NULL, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`;
  }

  const res = await pool.query(query, [taskId, userId]);
  return res.rows[0];
};

export const deleteTaskByUserId = async (userId: string, taskId: number) => {
  const res = await pool.query(
    `DELETE FROM todo_items WHERE id = $1 AND user_id = $2 RETURNING *`,
    [taskId, userId]
  );
  return res.rows[0];
};
