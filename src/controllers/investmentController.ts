import { Request, Response } from "express";
import { addInvestment, listInvestments } from "../services/financeService";

export const add = async (req: Request, res: Response) => {
  try {
    const { wa_id, asset_name, amount } = req.body;

    if (!asset_name || !amount) {
      return res
        .status(400)
        .json({ error: "Campos 'asset_name' e 'amount' são obrigatórios." });
    }

    const result = await addInvestment(wa_id, asset_name, amount);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const list = async (req: Request, res: Response) => {
  try {
    const { wa_id } = req.body;
    if (!wa_id) {
      return res.status(400).json({ error: "Campo 'wa_id' é obrigatório." });
    }
    const investments = await listInvestments(wa_id);
    res.json(investments);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
