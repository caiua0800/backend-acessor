import moment from "moment";
import { pool } from "../db";

// --- 1. FUNÇÃO DE PARSING INTELIGENTE ---
export const parseMoney = (value: any): number => {
  if (typeof value === "number") return value;
  if (!value) return 0;

  let clean = value.toString().trim();
  clean = clean.replace(/[^\d.,-]/g, "");

  if (clean.includes(",") && clean.length - clean.lastIndexOf(",") <= 3) {
    clean = clean.replace(/\./g, "");
    clean = clean.replace(",", ".");
  } else {
    clean = clean.replace(/,/g, "");
  }

  const result = parseFloat(clean);
  return isNaN(result) ? 0 : result;
};

// --- HELPER PRIVADO ---
const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0) throw new Error("Usuário não encontrado");
  return res.rows[0].id;
};

// ============================================================================
// 🤖 FUNÇÕES PARA O BOT (VIA WHATSAPP ID)
// ============================================================================

// --- 2. CONFIGURAR PERFIL ---
export const setFinanceSettings = async (
  whatsappId: string,
  income: any,
  limit: any,
  currentBalance: any,
  currency: string = "BRL"
) => {
  const userId = await getUserId(whatsappId);
  return setFinanceSettingsByUserId(
    userId,
    income,
    limit,
    currentBalance,
    currency
  );
};

// --- 3. ADICIONAR TRANSAÇÃO ---
export const addTransaction = async (whatsappId: string, data: any) => {
  const userId = await getUserId(whatsappId);
  return addTransactionByUserId(userId, data);
};

// --- 4. RELATÓRIO COMPLETO ---
export const getFinanceReport = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  return getFinanceReportByUserId(userId);
};

// --- 5. LISTAR ÚLTIMAS TRANSAÇÕES ---
export const getLastTransactions = async (whatsappId: string, limit = 10) => {
  const userId = await getUserId(whatsappId);
  return getLastTransactionsByUserId(userId, limit);
};

// --- 6. INVESTIMENTOS ---
export const addInvestment = async (
  whatsappId: string,
  assetName: string,
  amount: any
) => {
  const userId = await getUserId(whatsappId);
  return addInvestmentByUserId(userId, assetName, amount);
};

export const listInvestments = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  return listInvestmentsByUserId(userId);
};

// ============================================================================
// 📱 FUNÇÕES PARA A API / CONTROLLER (VIA USER ID / TOKEN)
// ============================================================================

export const setFinanceSettingsByUserId = async (
  userId: string,
  income: any,
  limit: any,
  currentBalance: any,
  currency: string = "BRL"
) => {
  const checkRes = await pool.query(
    `SELECT estimated_monthly_income, spending_limit, current_account_amount 
     FROM finance_settings WHERE user_id = $1`,
    [userId]
  );

  let finalIncome = 0;
  let finalLimit = 0;
  let finalBalance = 0;

  if (checkRes.rows.length > 0) {
    const current = checkRes.rows[0];

    finalIncome =
      income !== undefined && income !== null
        ? parseMoney(income)
        : parseFloat(current.estimated_monthly_income || 0);

    finalLimit =
      limit !== undefined && limit !== null
        ? parseMoney(limit)
        : parseFloat(current.spending_limit || 0);

    finalBalance =
      currentBalance !== undefined && currentBalance !== null
        ? parseMoney(currentBalance)
        : parseFloat(current.current_account_amount || 0);

    await pool.query(
      `UPDATE finance_settings 
       SET estimated_monthly_income = $1, 
           spending_limit = $2, 
           current_account_amount = $3, 
           currency = $4
       WHERE user_id = $5`,
      [finalIncome, finalLimit, finalBalance, currency, userId]
    );
  } else {
    finalIncome = parseMoney(income);
    finalLimit = parseMoney(limit);
    finalBalance = parseMoney(currentBalance);

    await pool.query(
      `INSERT INTO finance_settings 
        (user_id, estimated_monthly_income, spending_limit, current_account_amount, currency)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, finalIncome, finalLimit, finalBalance, currency]
    );
  }

  return "Configurações salvas.";
};

export const addTransactionByUserId = async (userId: string, data: any) => {
  const amountVal = Math.abs(parseMoney(data.amount));
  const type = data.type ? data.type.toLowerCase().trim() : "expense";

  let transactionDate = new Date();
  if (data.date) {
    if (data.date.includes("T")) {
      transactionDate = new Date(data.date);
    } else {
      transactionDate = new Date(`${data.date}T00:00:00`);
    }
  }
  if (isNaN(transactionDate.getTime())) transactionDate = new Date();

  const createdAt = new Date();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const settingsRes = await client.query(
      `SELECT current_account_amount FROM finance_settings WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );

    let currentBalance = 0;
    if (settingsRes.rows.length > 0) {
      currentBalance = parseFloat(
        settingsRes.rows[0].current_account_amount || 0
      );
    } else {
      await client.query(
        `INSERT INTO finance_settings (user_id, current_account_amount, estimated_monthly_income, spending_limit) 
         VALUES ($1, 0, 0, 0)`,
        [userId]
      );
    }

    const beforeAmount = currentBalance;
    let afterAmount = currentBalance;

    if (type === "income") {
      afterAmount = currentBalance + amountVal;
    } else {
      afterAmount = currentBalance - amountVal;
    }

    await client.query(
      `INSERT INTO transactions 
       (user_id, amount, type, category, description, receipt_url, transaction_date, before_account_amount, current_account_amount, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId,
        amountVal,
        type,
        data.category || (type === "income" ? "Entrada" : "Outros"),
        data.description || "",
        data.receipt_url || null,
        transactionDate,
        beforeAmount,
        afterAmount,
        createdAt,
      ]
    );

    await client.query(
      `UPDATE finance_settings SET current_account_amount = $1 WHERE user_id = $2`,
      [afterAmount, userId]
    );

    await client.query("COMMIT");

    return `Sucesso.`;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

export const getFinanceReportByUserId = async (userId: string) => {
  const settingsRes = await pool.query(
    "SELECT * FROM finance_settings WHERE user_id = $1",
    [userId]
  );

  const settings = settingsRes.rows[0] || {};
  const currentBalance = parseFloat(settings.current_account_amount || 0);
  const spendingLimit = parseFloat(settings.spending_limit || 0);
  const estimatedIncome = parseFloat(settings.estimated_monthly_income || 0);

  const summaryRes = await pool.query(
    `SELECT type, SUM(amount) as total 
     FROM transactions 
     WHERE user_id = $1 
     AND transaction_date >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo') 
     GROUP BY type`,
    [userId]
  );

  let incomeMonth = 0;
  let expenseMonth = 0;

  summaryRes.rows.forEach((row) => {
    if (row.type === "income") incomeMonth = parseFloat(row.total);
    if (row.type === "expense") expenseMonth = parseFloat(row.total);
  });

  return {
    moeda: settings.currency || "BRL",
    saldo_atual_conta: currentBalance,
    config: {
      renda_estipulada: estimatedIncome,
      limite_estipulado: spendingLimit,
    },
    resumo_mes: {
      ganhos: incomeMonth,
      gastos: expenseMonth,
      balanco_mes: incomeMonth - expenseMonth,
    },
    meta: {
      limite: spendingLimit,
      gasto_atual: expenseMonth,
      disponivel_para_gastar: spendingLimit - expenseMonth,
      percentual_gasto:
        spendingLimit > 0 ? (expenseMonth / spendingLimit) * 100 : 0,
    },
  };
};

export const getLastTransactionsByUserId = async (
  userId: string,
  limit = 10
) => {
  const res = await pool.query(
    `SELECT amount, type, category, description, transaction_date 
     FROM transactions 
     WHERE user_id = $1 
     ORDER BY transaction_date DESC 
     LIMIT $2`,
    [userId, limit]
  );

  return res.rows.map((row) => ({
    amount: parseFloat(row.amount),
    type: row.type,
    category: row.category,
    description: row.description,
    date: row.transaction_date,
  }));
};

export const addInvestmentByUserId = async (
  userId: string,
  assetName: string,
  amount: any
) => {
  const amountVal = parseMoney(amount);
  if (amountVal <= 0) throw new Error("Valor inválido.");

  const res = await pool.query(
    `INSERT INTO investments (user_id, asset_name, amount, investment_date)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
    [userId, assetName, amountVal]
  );

  return { message: "Investimento registrado!", investment: res.rows[0] };
};

export const listInvestmentsByUserId = async (userId: string) => {
  const res = await pool.query(
    `SELECT asset_name, SUM(amount) as total_invested, COUNT(*) as contributions
       FROM investments WHERE user_id = $1 GROUP BY asset_name ORDER BY total_invested DESC`,
    [userId]
  );

  const totalPortfolio = res.rows.reduce(
    (sum, row) => sum + parseFloat(row.total_invested),
    0
  );

  return {
    total_invested: totalPortfolio,
    summary_by_asset: res.rows.map((row) => ({
      asset: row.asset_name,
      total: parseFloat(row.total_invested),
      aportes: parseInt(row.contributions),
    })),
  };
};

export const addRecurringTransactionByUserId = async (userId: string, data: any) => {
  const amountVal = Math.abs(parseMoney(data.amount));
  const type = data.type ? data.type.toLowerCase().trim() : "expense";
  
  // Se o dia não for informado, usa o dia atual
  let day = data.day_of_month ? parseInt(data.day_of_month) : moment().date();
  if (day < 1) day = 1;
  if (day > 31) day = 31;

  const res = await pool.query(
    `INSERT INTO recurring_transactions 
     (user_id, amount, type, category, description, day_of_month)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      userId,
      amountVal,
      type,
      data.category || (type === "income" ? "Entrada Fixa" : "Gasto Fixo"),
      data.description || "Recorrência",
      day
    ]
  );

  return res.rows[0];
};

// 2. PROCESSAR RECORRÊNCIAS DO DIA (CRON JOB)
export const processDailyRecurringTransactions = async () => {
  const client = await pool.connect();
  // Garante fuso horário correto para não rodar no dia errado
  const today = moment().tz("America/Sao_Paulo");
  const currentDay = today.date();
  const currentMonthStr = today.format("YYYY-MM"); // Ex: 2023-12

  console.log(`🔄 [CRON FINANCEIRO] Buscando contas fixas para o dia ${currentDay}...`);

  try {
    // Busca tudo que vence hoje, está ativo, E AINDA NÃO FOI PROCESSADO ESTE MÊS
    const res = await client.query(
      `SELECT * FROM recurring_transactions 
       WHERE day_of_month = $1 
       AND active = TRUE
       AND (last_processed_at IS NULL OR TO_CHAR(last_processed_at, 'YYYY-MM') != $2)`,
      [currentDay, currentMonthStr]
    );

    if (res.rows.length === 0) {
      console.log("✅ [CRON FINANCEIRO] Nenhuma conta fixa para processar hoje.");
      return;
    }

    console.log(`💸 [CRON FINANCEIRO] Processando ${res.rows.length} itens...`);

    for (const item of res.rows) {
      try {
        await client.query("BEGIN");

        // --- LÓGICA DE SALDO (Cópia simplificada do addTransaction) ---
        const settingsRes = await client.query(
            `SELECT current_account_amount FROM finance_settings WHERE user_id = $1 FOR UPDATE`,
            [item.user_id]
        );
        
        let currentBalance = 0;
        if (settingsRes.rows.length > 0) {
            currentBalance = parseFloat(settingsRes.rows[0].current_account_amount || 0);
        } else {
            await client.query(
                `INSERT INTO finance_settings (user_id, current_account_amount) VALUES ($1, 0)`,
                [item.user_id]
            );
        }

        const amountVal = parseFloat(item.amount);
        const beforeAmount = currentBalance;
        let afterAmount = currentBalance;

        if (item.type === "income") afterAmount += amountVal;
        else afterAmount -= amountVal;

        // 1. Insere a transação no extrato
        await client.query(
          `INSERT INTO transactions 
           (user_id, amount, type, category, description, transaction_date, before_account_amount, current_account_amount, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, NOW())`,
          [
            item.user_id,
            amountVal,
            item.type,
            item.category,
            `${item.description} (Automático)`, // Identificador
            beforeAmount,
            afterAmount
          ]
        );

        // 2. Atualiza saldo do usuário
        await client.query(
            `UPDATE finance_settings SET current_account_amount = $1 WHERE user_id = $2`,
            [afterAmount, item.user_id]
        );

        // 3. Marca a recorrência como processada (para não rodar dnv hoje/este mês)
        await client.query(
            `UPDATE recurring_transactions SET last_processed_at = NOW() WHERE id = $1`,
            [item.id]
        );

        await client.query("COMMIT");
        console.log(`✅ Item ${item.id} (${item.description}) processado para User ${item.user_id}`);

      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`❌ Erro ao processar item recorrente ${item.id}:`, err);
      }
    }
  } catch (e) {
    console.error("❌ Erro fatal no Cron Financeiro:", e);
  } finally {
    client.release();
  }
};

export const addRecurringTransaction = async (whatsappId: string, data: any) => {
  const userId = await getUserId(whatsappId);
  return addRecurringTransactionByUserId(userId, data);
};

export const searchTransactionsByUserId = async (
  userId: string,
  limit: number,
  offset: number,
  categoryFilter?: string,
  descriptionFilter?: string
) => {
  // Queries base
  let countQuery = `SELECT COUNT(*) FROM transactions WHERE user_id = $1`;
  let dataQuery = `SELECT id, amount, type, category, description, transaction_date FROM transactions WHERE user_id = $1`;
  
  const baseParams = [userId];
  let filterIndex = 2; // O primeiro parâmetro ($1) é sempre o userId
  
  // 1. Constrói a cláusula WHERE para filtros
  const whereClauses = [];
  
  if (categoryFilter) {
    whereClauses.push(`category = $${filterIndex++}`);
    baseParams.push(categoryFilter);
  }
  
  if (descriptionFilter) {
    // unaccent(): Remove acentos (requer a extensão unaccent no seu DB)
    // LOWER() e ILIKE: Garantem que a comparação seja case-insensitive.
    whereClauses.push(`unaccent(LOWER(description)) ILIKE unaccent(LOWER($${filterIndex++}))`);
    baseParams.push(`%${descriptionFilter}%`);
  }

  if (whereClauses.length > 0) {
    const whereCondition = whereClauses.join(' AND ');
    countQuery += ` AND ${whereCondition}`;
    dataQuery += ` AND ${whereCondition}`;
  }
  
  // 2. Query para o total count (usa os mesmos parâmetros de filtro)
  const totalCountRes = await pool.query(countQuery, baseParams);
  const totalCount = parseInt(totalCountRes.rows[0].count, 10);
  
  // 3. Query para todas as categorias (para o filtro do frontend)
  const categoryRes = await pool.query(
    "SELECT DISTINCT category FROM transactions WHERE user_id = $1 AND category IS NOT NULL ORDER BY category ASC",
    [userId]
  );
  const categories = categoryRes.rows.map(row => row.category);

  // 4. Query para os dados paginados
  const dataParams = [...baseParams];
  // Adiciona ORDER BY, LIMIT e OFFSET no final
  dataQuery += ` ORDER BY transaction_date DESC LIMIT $${filterIndex++} OFFSET $${filterIndex++}`;
  
  dataParams.push(limit.toString());
  dataParams.push(offset.toString());
  
  const dataRes = await pool.query(dataQuery, dataParams);
  
  const transactions = dataRes.rows.map(row => ({
    id: row.id,
    amount: parseFloat(row.amount),
    type: row.type,
    category: row.category,
    description: row.description,
    date: row.transaction_date,
  }));
  
  return {
    transactions,
    total: totalCount,
    categories,
    page: offset / limit + 1,
    limit: limit
  };
};