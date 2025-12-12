import moment from "moment";
import { pool } from "../db";

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

// --- 7. GASTOS FIXOS PENDENTES (NOVO) ---
export const getPendingRecurringExpensesTotal = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);

  // Define o mês atual (ex: '2023-10') para comparar com last_processed_at
  const currentMonthStr = moment().tz("America/Sao_Paulo").format("YYYY-MM");

  // Soma as recorrências ativas que são despesas E que ainda não foram processadas neste mês
  const res = await pool.query(
    `SELECT SUM(amount) as total 
     FROM recurring_transactions 
     WHERE user_id = $1 
     AND (active = TRUE OR active IS NULL) 
     AND type = 'expense'
     AND (last_processed_at IS NULL OR TO_CHAR(last_processed_at, 'YYYY-MM') != $2)`,
    [userId, currentMonthStr]
  );

  return parseFloat(res.rows[0].total || 0);
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

    // CORREÇÃO CRÍTICA: Só atualiza se o novo valor for válido (>0 ou explicitamente passado corretamente)
    // Evita que strings vazias "" ou undefined zerem o banco
    const parsedIncome =
      income !== undefined && income !== null && income !== ""
        ? parseMoney(income)
        : undefined;
    finalIncome =
      parsedIncome !== undefined
        ? parsedIncome
        : parseFloat(current.estimated_monthly_income || 0);

    const parsedLimit =
      limit !== undefined && limit !== null && limit !== ""
        ? parseMoney(limit)
        : undefined;
    // Se parsedLimit for 0, assumimos que foi erro de extração, a menos que queira zerar (que seria outro fluxo)
    // Mantém o valor antigo se o novo for inválido
    finalLimit =
      parsedLimit !== undefined && parsedLimit > 0
        ? parsedLimit
        : parseFloat(current.spending_limit || 0);

    const parsedBalance =
      currentBalance !== undefined &&
      currentBalance !== null &&
      currentBalance !== ""
        ? parseMoney(currentBalance)
        : undefined;
    finalBalance =
      parsedBalance !== undefined
        ? parsedBalance
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
    // Se não existe, cria com o que veio (ou 0)
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
    const d = new Date(data.date);
    if (!isNaN(d.getTime())) {
      transactionDate = d;
    }
  }

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
        `INSERT INTO finance_settings (user_id, current_account_amount, estimated_monthly_income, spending_limit) VALUES ($1, 0, 0, 0)`,
        [userId]
      );
    }

    const beforeAmount = currentBalance;
    let afterAmount =
      type === "income"
        ? currentBalance + amountVal
        : currentBalance - amountVal;

    await client.query(
      `INSERT INTO transactions 
       (user_id, amount, type, category, description, receipt_url, transaction_date, before_account_amount, current_account_amount, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
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

export const addRecurringTransactionByUserId = async (
  userId: string,
  data: any
) => {
  const amountVal = Math.abs(parseMoney(data.amount));
  const type = data.type ? data.type.toLowerCase().trim() : "expense";

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
      day,
    ]
  );

  return res.rows[0];
};

export const processDailyRecurringTransactions = async () => {
  const client = await pool.connect();
  const today = moment().tz("America/Sao_Paulo");
  const currentDay = today.date();
  const currentMonthStr = today.format("YYYY-MM");

  console.log(
    `🔄 [CRON FINANCEIRO] Buscando contas fixas para o dia ${currentDay}...`
  );

  try {
    const res = await client.query(
      `SELECT * FROM recurring_transactions 
       WHERE day_of_month = $1 
       AND active = TRUE
       AND (last_processed_at IS NULL OR TO_CHAR(last_processed_at, 'YYYY-MM') != $2)`,
      [currentDay, currentMonthStr]
    );

    if (res.rows.length === 0) {
      console.log(
        "✅ [CRON FINANCEIRO] Nenhuma conta fixa para processar hoje."
      );
      return;
    }

    console.log(`💸 [CRON FINANCEIRO] Processando ${res.rows.length} itens...`);

    for (const item of res.rows) {
      try {
        await client.query("BEGIN");

        const settingsRes = await client.query(
          `SELECT current_account_amount FROM finance_settings WHERE user_id = $1 FOR UPDATE`,
          [item.user_id]
        );

        let currentBalance = 0;
        if (settingsRes.rows.length > 0) {
          currentBalance = parseFloat(
            settingsRes.rows[0].current_account_amount || 0
          );
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

        await client.query(
          `INSERT INTO transactions 
           (user_id, amount, type, category, description, transaction_date, before_account_amount, current_account_amount, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, NOW())`,
          [
            item.user_id,
            amountVal,
            item.type,
            item.category,
            `${item.description} (Automático)`,
            beforeAmount,
            afterAmount,
          ]
        );

        await client.query(
          `UPDATE finance_settings SET current_account_amount = $1 WHERE user_id = $2`,
          [afterAmount, item.user_id]
        );

        await client.query(
          `UPDATE recurring_transactions SET last_processed_at = NOW() WHERE id = $1`,
          [item.id]
        );

        await client.query("COMMIT");
        console.log(
          `✅ Item ${item.id} (${item.description}) processado para User ${item.user_id}`
        );
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

export const addRecurringTransaction = async (
  whatsappId: string,
  data: any
) => {
  const userId = await getUserId(whatsappId);
  return addRecurringTransactionByUserId(userId, data);
};

export const getRecurringExpensesTotal = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);

  const res = await pool.query(
    `SELECT SUM(amount) as total 
     FROM recurring_transactions 
     WHERE user_id = $1 
     AND (active = TRUE OR active IS NULL) 
     AND type = 'expense'`,
    [userId]
  );

  const total = parseFloat(res.rows[0].total || 0);

  const listRes = await pool.query(
    `SELECT description, amount, day_of_month 
     FROM recurring_transactions 
     WHERE user_id = $1 
     AND (active = TRUE OR active IS NULL)
     AND type = 'expense'
     ORDER BY day_of_month ASC`,
    [userId]
  );

  return {
    total: total,
    items: listRes.rows.map((r) => ({
      description: r.description,
      amount: parseFloat(r.amount),
      day: r.day_of_month,
    })),
  };
};

export const searchTransactionsByUserId = async (
  userId: string,
  limit: number,
  offset: number,
  categoryFilter?: string,
  descriptionFilter?: string
) => {
  let countQuery = `SELECT COUNT(*) FROM transactions WHERE user_id = $1`;
  let dataQuery = `SELECT id, amount, type, category, description, transaction_date FROM transactions WHERE user_id = $1`;

  const baseParams = [userId];
  let filterIndex = 2;

  const whereClauses = [];

  if (categoryFilter) {
    whereClauses.push(`category = $${filterIndex++}`);
    baseParams.push(categoryFilter);
  }

  if (descriptionFilter) {
    whereClauses.push(
      `unaccent(LOWER(description)) ILIKE unaccent(LOWER($${filterIndex++}))`
    );
    baseParams.push(`%${descriptionFilter}%`);
  }

  if (whereClauses.length > 0) {
    const whereCondition = whereClauses.join(" AND ");
    countQuery += ` AND ${whereCondition}`;
    dataQuery += ` AND ${whereCondition}`;
  }

  const totalCountRes = await pool.query(countQuery, baseParams);
  const totalCount = parseInt(totalCountRes.rows[0].count, 10);

  const categoryRes = await pool.query(
    "SELECT DISTINCT category FROM transactions WHERE user_id = $1 AND category IS NOT NULL ORDER BY category ASC",
    [userId]
  );
  const categories = categoryRes.rows.map((row) => row.category);

  const dataParams = [...baseParams];
  dataQuery += ` ORDER BY transaction_date DESC LIMIT $${filterIndex++} OFFSET $${filterIndex++}`;

  dataParams.push(limit.toString());
  dataParams.push(offset.toString());

  const dataRes = await pool.query(dataQuery, dataParams);

  const transactions = dataRes.rows.map((row) => ({
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
    limit: limit,
  };
};

export const listRecurringTransactionsByUserId = async (
  userId: string,
  limit: number,
  offset: number
) => {
  const countRes = await pool.query(
    "SELECT COUNT(*) FROM recurring_transactions WHERE user_id = $1",
    [userId]
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const res = await pool.query(
    `SELECT * FROM recurring_transactions 
     WHERE user_id = $1 
     ORDER BY day_of_month ASC, created_at DESC 
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const items = res.rows.map((row) => ({
    id: row.id,
    description: row.description,
    amount: parseFloat(row.amount),
    type: row.type,
    category: row.category,
    day_of_month: row.day_of_month,
    active: row.active,
    last_processed_at: row.last_processed_at,
  }));

  return {
    items,
    total,
    page: offset / limit + 1,
    limit,
    total_pages: Math.ceil(total / limit),
  };
};

export const searchInvestmentsByUserId = async (
  userId: string,
  limit: number,
  offset: number,
  assetNameFilter?: string
) => {
  let countQuery = `SELECT COUNT(*) FROM investments WHERE user_id = $1`;
  let dataQuery = `SELECT * FROM investments WHERE user_id = $1`;

  const params: any[] = [userId];
  let paramIndex = 2;

  if (assetNameFilter) {
    const clause = ` AND unaccent(LOWER(asset_name)) ILIKE unaccent(LOWER($${paramIndex}))`;
    countQuery += clause;
    dataQuery += clause;
    params.push(`%${assetNameFilter}%`);
    paramIndex++;
  }

  const countRes = await pool.query(
    countQuery,
    params.slice(0, paramIndex - 1)
  );
  const total = parseInt(countRes.rows[0].count, 10);

  dataQuery += ` ORDER BY investment_date DESC LIMIT $${paramIndex} OFFSET $${
    paramIndex + 1
  }`;
  params.push(limit, offset);

  const dataRes = await pool.query(dataQuery, params);

  return {
    investments: dataRes.rows.map((row) => ({
      ...row,
      amount: parseFloat(row.amount),
    })),
    total,
    page: offset / limit + 1,
    limit,
    total_pages: Math.ceil(total / limit),
  };
};

export const updateInvestmentByUserId = async (
  userId: string,
  investmentId: string,
  assetName?: string,
  amount?: any
) => {
  const fields = [];
  const values = [];
  let paramIndex = 1;

  if (assetName) {
    fields.push(`asset_name = $${paramIndex++}`);
    values.push(assetName);
  }

  if (amount !== undefined) {
    const val = parseMoney(amount);
    if (val <= 0) throw new Error("O valor deve ser positivo.");
    fields.push(`amount = $${paramIndex++}`);
    values.push(val);
  }

  if (fields.length === 0) throw new Error("Nenhum dado para atualizar.");

  fields.push(`updated_at = NOW()`);
  values.push(investmentId, userId);

  const query = `
    UPDATE investments 
    SET ${fields.join(", ")} 
    WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
    RETURNING *
  `;

  const res = await pool.query(query, values);
  return res.rows[0];
};

export const deleteInvestmentByUserId = async (
  userId: string,
  investmentId: string
) => {
  const res = await pool.query(
    "DELETE FROM investments WHERE id = $1 AND user_id = $2 RETURNING id",
    [investmentId, userId]
  );
  return (res.rowCount ?? 0) > 0;
};

export const getPendingRecurringExpensesTotalByUserId = async (
  userId: string
) => {
  // Define o mês atual (ex: '2023-10') para comparar com last_processed_at
  const currentMonthStr = moment().tz("America/Sao_Paulo").format("YYYY-MM");

  // Soma as recorrências ativas que são despesas E que ainda não foram processadas neste mês
  const res = await pool.query(
    `SELECT SUM(amount) as total 
     FROM recurring_transactions 
     WHERE user_id = $1 
     AND (active = TRUE OR active IS NULL) 
     AND type = 'expense'
     AND (last_processed_at IS NULL OR TO_CHAR(last_processed_at, 'YYYY-MM') != $2)`,
    [userId, currentMonthStr]
  );

  return parseFloat(res.rows[0].total || 0);
};

// 2. Função Principal que monta o objeto de previsão
export const getBudgetForecastByUserId = async (userId: string) => {
  // Reutiliza o relatório existente para pegar Gasto e Teto
  const report = await getFinanceReportByUserId(userId);

  // Pega o pendente fixo
  const pendingRecurring = await getPendingRecurringExpensesTotalByUserId(
    userId
  );

  const limit = report.config.limite_estipulado || 0;
  const spentSoFar = report.resumo_mes.gastos || 0;

  // O Cálculo Mágico
  const available = limit - spentSoFar - pendingRecurring;

  return {
    currency: report.moeda,
    current_account_balance: report.saldo_atual_conta,
    forecast: {
      spending_limit: limit,
      spent_so_far: spentSoFar,
      pending_recurring: pendingRecurring,
      available_to_spend: available,
      status: available < 0 ? "negative" : "positive",
    },
  };
};


