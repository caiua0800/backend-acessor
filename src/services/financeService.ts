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
