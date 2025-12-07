import { Request, Response } from "express";
import {
  setFinanceSettings,
  addTransaction,
  getFinanceReport,
} from "../services/financeService";

export const updateSettings = async (req: Request, res: Response) => {
  try {
    const { wa_id, income, limit, currency, balance } = req.body;
    const msg = await setFinanceSettings(
      wa_id,
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

export const add = async (req: Request, res: Response) => {
  try {
    const { wa_id, amount, type, category, description, receipt_url, date } =
      req.body;
    const msg = await addTransaction(wa_id, {
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

export const report = async (req: Request, res: Response) => {
  try {
    const reportData = await getFinanceReport(req.body.wa_id);
    res.json(reportData);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
