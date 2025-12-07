// src/services/goalsService.ts
import { pool } from "../db";
import { parseMoney } from "./financeService";

// Interface para a criação de Meta
interface GoalCreationData {
  goal_name: string;
  target_amount: any; // Aceita string ou number
  metric_unit: string;
  category: string;
  deadline?: string;
  details_json?: object;
}

// Auxiliar para pegar o ID do usuário
const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0) throw new Error("Usuário não encontrado");
  return res.rows[0].id;
};

// Auxiliar para buscar a Meta pelo NOME (USANDO ILIKE E WILDCARDS)
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

// Auxiliar para buscar o histórico de progresso (para ser usado no listGoals)
const getGoalProgressHistory = async (goalId: string) => {
  const res = await pool.query(
    "SELECT amount, description, created_at FROM goals_progress WHERE goal_id = $1 ORDER BY created_at DESC",
    [goalId]
  );
  return res.rows;
};

// 1. goals_create
export const createGoal = async (
  whatsappId: string,
  data: GoalCreationData
) => {
  const userId = await getUserId(whatsappId);
  const targetAmount = parseMoney(data.target_amount);

  if (targetAmount <= 0) {
    throw new Error("O valor da meta deve ser maior que zero.");
  }

  const res = await pool.query(
    `INSERT INTO goals 
     (user_id, goal_name, target_amount, metric_unit, category, deadline, details_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId,
      data.goal_name,
      targetAmount,
      data.metric_unit,
      data.category,
      data.deadline || null,
      data.details_json || {},
    ]
  );
  return res.rows[0];
};

// 2. goals_update_progress (CORRIGIDA PARA USAR O NOME E DESCRIÇÃO)
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
  let updatedGoal = null;

  try {
    await client.query("BEGIN");

    // A. Atualiza o progresso na tabela goals
    const updateRes = await client.query(
      `UPDATE goals 
       SET current_progress = current_progress + $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [progressAmount, goalId, userId]
    );

    if ((updateRes.rowCount ?? 0) === 0) {
      throw new Error(
        "Meta não encontrada ou você não tem permissão para editá-la."
      );
    }
    updatedGoal = updateRes.rows[0];

    // B. (Opcional) Registra o incremento na tabela goals_progress
    if (Math.abs(progressAmount) > 0) {
      await client.query(
        `INSERT INTO goals_progress (goal_id, amount, description, source_transaction_id)
             VALUES ($1, $2, $3, $4)`,
        [
          goalId,
          progressAmount,
          description || null,
          sourceTransactionId || null,
        ]
      );
    }

    await client.query("COMMIT");

    // CORREÇÃO: Retorna o objeto da meta atualizada mais a descrição da ação
    return {
      ...updatedGoal,
      progress_description: description || "Progresso adicionado.",
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

// 3. goals_list (CORRIGIDO PARA INCLUIR HISTÓRICO)
export const listGoals = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);

  const res = await pool.query(
    `SELECT 
        id, goal_name, category, target_amount, current_progress, metric_unit, deadline, details_json
     FROM goals 
     WHERE user_id = $1 
     ORDER BY created_at DESC`,
    [userId]
  );

  const goalsWithHistoryPromises = res.rows.map(async (row) => {
    // Busca o histórico de progresso para CADA meta
    const history = await getGoalProgressHistory(row.id);

    return {
      ...row,
      target_amount: parseFloat(row.target_amount),
      current_progress: parseFloat(row.current_progress),
      progress_percent: (
        (parseFloat(row.current_progress) / parseFloat(row.target_amount)) *
        100
      ).toFixed(2),
      is_completed:
        parseFloat(row.current_progress) >= parseFloat(row.target_amount),
      progress_history: history, // <--- ADICIONA O HISTÓRICO AQUI
    };
  });

  // Executa todas as buscas de histórico em paralelo
  return Promise.all(goalsWithHistoryPromises);
};

// 4. goals_delete (CORRIGIDA PARA USAR O NOME)
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

// 5. goals_update (para detalhes e nome) (ADICIONAR BUSCA PELO NOME)
export const updateGoalDetails = async (
  whatsappId: string,
  goalName: string,
  data: Partial<GoalCreationData>
) => {
  const userId = await getUserId(whatsappId);
  const goalId = await getGoalByName(userId, goalName);

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
    // Usa o operador de concatenação JSONB para atualizar o JSON, não sobrescrever
    fields.push(`details_json = details_json || $${queryIndex++}`);
    values.push(data.details_json);
  }

  if (fields.length === 0) {
    throw new Error(
      "Nenhum campo fornecido para atualização de detalhes da meta."
    );
  }

  fields.push("updated_at = NOW()");
  values.push(goalId, userId); // Valores para o WHERE (ID E USER_ID)

  const res = await pool.query(
    `UPDATE goals 
         SET ${fields.join(", ")} 
         WHERE id = $${queryIndex++} AND user_id = $${queryIndex++} 
         RETURNING *`,
    values
  );

  return res.rows[0];
};

// 4. goals_delete
export const deleteGoal = async (whatsappId: string, goalId: string) => {
  const userId = await getUserId(whatsappId);

  const res = await pool.query(
    "DELETE FROM goals WHERE id = $1 AND user_id = $2 RETURNING id",
    [goalId, userId]
  );

  return (res.rowCount ?? 0) > 0;
};
