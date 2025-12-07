import { pool } from "../db";
import { parseMoney } from "./financeService"; // Reutilize o parseMoney se estiver exportado lá

// Interface para a criação de Meta
interface GoalCreationData {
  goal_name: string;
  target_amount: any; // Aceita string ou number
  metric_unit: string;
  category: string;
  deadline?: string;
  details_json?: object;
}

// Auxiliar para pegar o ID do usuário (reutilize de outro service se já tiver)
const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0) throw new Error("Usuário não encontrado");
  return res.rows[0].id;
};

// Auxiliar para buscar a Meta pelo NOME
const getGoalByName = async (userId: string, goalName: string) => {
  // CORREÇÃO CRÍTICA: Adiciona % wildcards para busca parcial
  const searchTerm = `%${goalName.trim()}%`; 

  const res = await pool.query(
      // Busca a meta cujo nome CONTENHA o termo extraído pelo LLM.
      // Ex: LLM manda 'Emagrecer', o DB busca por '%Emagrecer%' e encontra 'Emagrecer 9KG'.
      "SELECT id FROM goals WHERE user_id = $1 AND goal_name ILIKE $2 ORDER BY LENGTH(goal_name) ASC",
      [userId, searchTerm]
  );
  
  // ORDENA POR LENGTH para tentar pegar a correspondência mais próxima (menor nome) primeiro,
  // mas o principal é o ILIKE %.

  if (res.rows.length === 0) {
      throw new Error(`Meta com o nome '${goalName}' não encontrada.`);
  }
  // Retorna o ID da primeira meta encontrada
  return res.rows[0].id; 
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

// 2. goals_update_progress (CORRIGIDA PARA USAR O NOME)
export const updateGoalProgress = async (
  whatsappId: string,
  goalName: string, // AGORA RECEBE O NOME
  amount: any,
  description?: string,
  sourceTransactionId?: string
) => {
  const userId = await getUserId(whatsappId);
  const goalId = await getGoalByName(userId, goalName); // BUSCA O ID PELO NOME

  const progressAmount = parseMoney(amount);

  if (progressAmount === 0) {
    throw new Error("O valor do progresso não pode ser zero.");
  }

  const client = await pool.connect();
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
    return updateRes.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

// 3. goals_list
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

  // Calcula o progresso em % para facilitar a leitura da IA
  return res.rows.map((row) => ({
    ...row,
    target_amount: parseFloat(row.target_amount),
    current_progress: parseFloat(row.current_progress),
    progress_percent: (
      (parseFloat(row.current_progress) / parseFloat(row.target_amount)) *
      100
    ).toFixed(2),
    is_completed:
      parseFloat(row.current_progress) >= parseFloat(row.target_amount),
  }));
};

// 4. goals_delete (CORRIGIDA PARA USAR O NOME)
export const deleteGoalByName = async (whatsappId: string, goalName: string) => {
    const userId = await getUserId(whatsappId);
    const goalId = await getGoalByName(userId, goalName); // BUSCA O ID PELO NOME

    const res = await pool.query(
        "DELETE FROM goals WHERE id = $1 AND user_id = $2 RETURNING id",
        [goalId, userId]
    );

    return (res.rowCount ?? 0) > 0;
};

// 5. goals_update (para detalhes e nome) (ADICIONAR BUSCA PELO NOME)
export const updateGoalDetails = async (
  whatsappId: string,
  goalName: string, // AGORA RECEBE O NOME
  data: Partial<GoalCreationData>
) => {
  const userId = await getUserId(whatsappId);
  const goalId = await getGoalByName(userId, goalName); // BUSCA O ID PELO NOME


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

  // CORREÇÃO TS18047 AQUI
  return (res.rowCount ?? 0) > 0;
};