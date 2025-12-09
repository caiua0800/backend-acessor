import { pool } from "../db";
// Importamos o parseMoney do financeiro para garantir consistência
import { parseMoney } from "./financeService";

interface GoalCreationData {
  goal_name: string;
  target_amount: any;
  metric_unit: string;
  category: string;
  deadline?: string;
  details_json?: object;
}

// --- HELPER PRIVADO ---
const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0) throw new Error("Usuário não encontrado");
  return res.rows[0].id;
};

// --- HELPER PRIVADO: Busca ID pelo Nome (Para a IA) ---
const getGoalByName = async (userId: string, goalName: string) => {
  const searchTerm = `%${goalName.trim()}%`;
  const res = await pool.query(
    "SELECT id FROM goals WHERE user_id = $1 AND goal_name ILIKE $2 ORDER BY LENGTH(goal_name) ASC",
    [userId, searchTerm]
  );
  if (res.rows.length === 0) {
    throw new Error(`Meta com o nome '${goalName}' não encontrada.`);
  }
  return res.rows[0].id;
};

// --- HELPER PRIVADO: Histórico ---
const getGoalProgressHistory = async (goalId: string) => {
  const res = await pool.query(
    "SELECT amount, description, created_at FROM goals_progress WHERE goal_id = $1 ORDER BY created_at DESC",
    [goalId]
  );
  return res.rows;
};

// ==========================================================
// FUNÇÕES PRINCIPAIS
// ==========================================================

// 1. CRIAR META (Usado por IA e Controller)
export const createGoal = async (
  whatsappId: string,
  data: GoalCreationData
) => {
  const userId = await getUserId(whatsappId);
  const targetAmount = parseMoney(data.target_amount);

  if (targetAmount <= 0) {
    throw new Error("O valor da meta deve ser maior que zero.");
  }

  // Tratamento para evitar string vazia no deadline
  const deadlineValue =
    data.deadline && data.deadline.trim() !== "" ? data.deadline : null;

  const res = await pool.query(
    `INSERT INTO goals 
     (user_id, goal_name, target_amount, metric_unit, category, deadline, details_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId,
      data.goal_name,
      targetAmount,
      data.metric_unit || "Unid",
      data.category || "Geral",
      deadlineValue,
      data.details_json || {},
    ]
  );
  return res.rows[0];
};

// 2. ATUALIZAR PROGRESSO (Usado por IA)
export const updateGoalProgress = async (
  whatsappId: string,
  goalName: string,
  amount: any,
  description?: string,
  sourceTransactionId?: string
) => {
  const userId = await getUserId(whatsappId);
  const goalId = await getGoalByName(userId, goalName);

  const progressAmount = parseMoney(amount);

  if (progressAmount === 0) {
    throw new Error("O valor do progresso não pode ser zero.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // A. Atualiza o valor na meta
    const updateRes = await client.query(
      `UPDATE goals 
       SET current_progress = current_progress + $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [progressAmount, goalId, userId]
    );

    if ((updateRes.rowCount ?? 0) === 0) {
      throw new Error("Meta não encontrada.");
    }
    const updatedGoal = updateRes.rows[0];

    // B. Registra histórico
    await client.query(
      `INSERT INTO goals_progress (goal_id, amount, description, source_transaction_id)
       VALUES ($1, $2, $3, $4)`,
      [goalId, progressAmount, description || null, sourceTransactionId || null]
    );

    await client.query("COMMIT");

    // Retorna com cálculo de porcentagem atualizado
    const target = parseFloat(updatedGoal.target_amount);
    const current = parseFloat(updatedGoal.current_progress);

    return {
      ...updatedGoal,
      target_amount: target,
      current_progress: current,
      progress_percent: target > 0 ? ((current / target) * 100).toFixed(1) : 0,
      progress_description: description,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

// 3. LISTAR METAS (Usado por IA e Controller)
export const listGoals = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);

  const res = await pool.query(
    `SELECT * FROM goals WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  const goalsWithHistoryPromises = res.rows.map(async (row) => {
    const history = await getGoalProgressHistory(row.id);
    const target = parseFloat(row.target_amount);
    const progress = parseFloat(row.current_progress);

    return {
      ...row,
      target_amount: target,
      current_progress: progress,
      progress_percent: target > 0 ? ((progress / target) * 100).toFixed(2) : 0,
      is_completed: progress >= target,
      progress_history: history,
    };
  });

  return Promise.all(goalsWithHistoryPromises);
};

// 4. DELETAR META POR NOME (Usado pela IA)
export const deleteGoalByName = async (
  whatsappId: string,
  goalName: string
) => {
  const userId = await getUserId(whatsappId);
  const goalId = await getGoalByName(userId, goalName);

  const res = await pool.query(
    "DELETE FROM goals WHERE id = $1 AND user_id = $2 RETURNING id",
    [goalId, userId]
  );

  return (res.rowCount ?? 0) > 0;
};

// ==========================================================
// FUNÇÕES EXTRAS (RESTORED FOR CONTROLLER)
// ==========================================================

// 5. DELETAR META POR ID (Usado pelo Controller REST API)
export const deleteGoal = async (whatsappId: string, goalId: string) => {
  const userId = await getUserId(whatsappId);

  const res = await pool.query(
    "DELETE FROM goals WHERE id = $1 AND user_id = $2 RETURNING id",
    [goalId, userId]
  );

  return (res.rowCount ?? 0) > 0;
};

// 6. ATUALIZAR DETALHES (Usado pelo Controller REST API)
// Permite editar nome, valor alvo, data, etc.
export const updateGoalDetails = async (
  whatsappId: string,
  goalIdOrName: string, // Pode vir ID do controller ou Nome se adaptar no futuro
  data: Partial<GoalCreationData>
) => {
  const userId = await getUserId(whatsappId);

  // Verifica se é UUID (assumindo que o ID é UUID). Se não for, busca pelo nome.
  // Se seu ID for inteiro, mude a regex para /^\d+$/
  const isUuid =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      goalIdOrName
    );

  let goalId = goalIdOrName;
  if (!isUuid) {
    try {
      goalId = await getGoalByName(userId, goalIdOrName);
    } catch (e) {
      // Se falhar a busca por nome, assume que o usuário passou um ID mesmo que não pareça UUID (ou falha)
    }
  }

  const fields = [];
  const values = [];
  let queryIndex = 1;

  if (data.goal_name) {
    fields.push(`goal_name = $${queryIndex++}`);
    values.push(data.goal_name);
  }
  if (data.target_amount) {
    fields.push(`target_amount = $${queryIndex++}`);
    values.push(parseMoney(data.target_amount));
  }
  if (data.metric_unit) {
    fields.push(`metric_unit = $${queryIndex++}`);
    values.push(data.metric_unit);
  }
  if (data.deadline) {
    fields.push(`deadline = $${queryIndex++}`);
    values.push(data.deadline);
  }
  if (data.details_json) {
    fields.push(`details_json = details_json || $${queryIndex++}`);
    values.push(data.details_json);
  }

  if (fields.length === 0) {
    throw new Error("Nenhum campo fornecido para atualização.");
  }

  fields.push("updated_at = NOW()");
  values.push(goalId, userId);

  const res = await pool.query(
    `UPDATE goals 
         SET ${fields.join(", ")} 
         WHERE id = $${queryIndex++} AND user_id = $${queryIndex++} 
         RETURNING *`,
    values
  );

  return res.rows[0];
};
