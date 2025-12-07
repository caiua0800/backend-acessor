import { pool } from "../db";

// --- FUNÇÃO DE LIMPEZA FINANCEIRA ---
export const parseMoney = (value: any): number => {
  if (typeof value === "number") return value;
  if (!value) return 0;

  let clean = value.toString().trim();
  // Limpa tudo que não é número ou pontuação decimal
  clean = clean.replace(/[^\d.,-]/g, "");

  // Lógica BR vs US
  if (clean.includes(",") && clean.length - clean.lastIndexOf(",") <= 3) {
    clean = clean.replace(/\./g, "");
    clean = clean.replace(",", ".");
  } else {
    clean = clean.replace(/,/g, "");
  }

  const result = parseFloat(clean);
  return isNaN(result) ? 0 : result;
};

const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0) throw new Error("Usuário não encontrado");
  return res.rows[0].id;
};

// 1. CONFIGURAR PERFIL
export const setFinanceSettings = async (
  whatsappId: string,
  income: any,
  limit: any,
  currentBalance: any,
  currency: string = "BRL"
) => {
  const userId = await getUserId(whatsappId);
  const incomeVal = parseMoney(income);
  const limitVal = parseMoney(limit);

  const hasBalanceUpdate =
    currentBalance !== undefined &&
    currentBalance !== null &&
    currentBalance !== "";
  const balanceVal = hasBalanceUpdate ? parseMoney(currentBalance) : null;

  const checkRes = await pool.query(
    "SELECT current_account_amount FROM finance_settings WHERE user_id = $1",
    [userId]
  );

  if (checkRes.rows.length > 0) {
    const currentDbBalance = parseFloat(
      checkRes.rows[0].current_account_amount || 0
    );
    const finalBalance = hasBalanceUpdate ? balanceVal : currentDbBalance;

    await pool.query(
      `UPDATE finance_settings 
       SET estimated_monthly_income = $1, 
           spending_limit = $2, 
           current_account_amount = $3, 
           currency = $4
       WHERE user_id = $5`,
      [incomeVal, limitVal, finalBalance, currency, userId]
    );
  } else {
    const finalBalance = hasBalanceUpdate ? balanceVal : 0;
    await pool.query(
      `INSERT INTO finance_settings (user_id, estimated_monthly_income, spending_limit, current_account_amount, currency)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, incomeVal, limitVal, finalBalance, currency]
    );
  }

  return "Configurações financeiras salvas com sucesso!";
};

// 2. ADICIONAR TRANSAÇÃO (CORREÇÃO DE FUSO NO CREATED_AT)
export const addTransaction = async (whatsappId: string, data: any) => {
  const userId = await getUserId(whatsappId);

  const amountVal = Math.abs(parseMoney(data.amount));
  const type = data.type ? data.type.toLowerCase().trim() : "expense";

  const dateStringInLocalTimezone = data.date ? `${data.date}T00:00:00` : null;
  const transactionDate = dateStringInLocalTimezone ? new Date(dateStringInLocalTimezone) : new Date();
  const createdAt = new Date(); 

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // A. Busca Saldo Atual
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
        `INSERT INTO finance_settings (user_id, current_account_amount) VALUES ($1, 0)`,
        [userId]
      );
    }

    // B. Calcula
    const beforeAmount = currentBalance;
    let afterAmount = currentBalance;

    if (type === "income") {
      afterAmount = currentBalance + amountVal;
    } else {
      afterAmount = currentBalance - amountVal;
    }

    // C. Salva (Passando created_at explicitamente)
    await client.query(
      `INSERT INTO transactions 
       (user_id, amount, type, category, description, receipt_url, transaction_date, before_account_amount, current_account_amount, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId,
        amountVal,
        type,
        data.category,
        data.description,
        data.receipt_url || null,
        transactionDate,
        beforeAmount,
        afterAmount,
        createdAt, // <--- AQUI VAI A DATA CORRETA DE BRASÍLIA
      ]
    );

    // D. Atualiza Saldo Global
    await client.query(
      `UPDATE finance_settings SET current_account_amount = $1 WHERE user_id = $2`,
      [afterAmount, userId]
    );

    await client.query("COMMIT");

    return `Feito! Valor: ${amountVal}. Saldo anterior: ${beforeAmount.toFixed(
      2
    )}. Novo saldo: ${afterAmount.toFixed(2)}.`
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

// 3. RELATÓRIO
export const getFinanceReport = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);

  const settingsRes = await pool.query(
    "SELECT * FROM finance_settings WHERE user_id = $1",
    [userId]
  );

  const settings = settingsRes.rows[0] || {};
  const currentBalance = parseFloat(settings.current_account_amount || 0);
  const spendingLimit = parseFloat(settings.spending_limit || 0);

  // Soma Mês Atual (A query SQL ainda usa o fuso do banco, mas podemos ajustar aqui se precisar)
  const summaryRes = await pool.query(
    `SELECT type, SUM(amount) as total 
     FROM transactions 
     WHERE user_id = $1 
     AND transaction_date >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo') -- Força fuso no select
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

export const addInvestment = async (
  whatsappId: string,
  assetName: string,
  amount: any
) => {
  const userId = await getUserId(whatsappId);
  const amountVal = parseMoney(amount);

  if (amountVal <= 0) {
    throw new Error("O valor do investimento deve ser maior que zero.");
  }

  // Simplesmente insere o registro na nova tabela
  const res = await pool.query(
    `INSERT INTO investments (user_id, asset_name, amount, investment_date)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
    [userId, assetName, amountVal]
  );

  return {
    message: "Investimento registrado com sucesso!",
    investment: res.rows[0],
  };
};

export const listInvestments = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);

  // Busca todos os investimentos e também a soma total por ativo
  const res = await pool.query(
    `SELECT 
          asset_name, 
          SUM(amount) as total_invested,
          COUNT(*) as contributions
       FROM investments
       WHERE user_id = $1
       GROUP BY asset_name
       ORDER BY total_invested DESC`,
    [userId]
  );

  // Calcula o total geral investido
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
