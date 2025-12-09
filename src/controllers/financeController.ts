import { Response } from "express";
import * as financeService from "../services/financeService";
import { AuthRequest } from "../middlewares/authMiddleware";

// POST /finance/settings
export const updateSettings = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!; // Pega do Token
    const { income, limit, currency, balance } = req.body;

    const msg = await financeService.setFinanceSettingsByUserId(
      userId,
      income,
      limit,
      balance,
      currency
    );
    res.json({ status: "success", message: msg });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// POST /finance/transaction
export const add = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { amount, type, category, description, receipt_url, date } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "O valor (amount) é obrigatório." });
    }

    const msg = await financeService.addTransactionByUserId(userId, {
      amount,
      type,
      category,
      description,
      receipt_url,
      date,
    });
    res.json({ status: "success", message: msg });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /finance/report
export const report = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const reportData = await financeService.getFinanceReportByUserId(userId);
    res.json(reportData);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /finance/transactions (NOVO: Para listar extrato no front)
export const listTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

    const transactions = await financeService.getLastTransactionsByUserId(
      userId,
      limit
    );
    res.json(transactions);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /finance/investments (NOVO: Para listar investimentos)
export const getInvestments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const data = await financeService.listInvestmentsByUserId(userId);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
