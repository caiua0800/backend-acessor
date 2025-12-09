import { Request, Response } from "express";
import * as financeService from "../services/financeService";
import { AuthRequest } from "../middlewares/authMiddleware";

// POST /investments
export const add = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!; // Pega o ID do Token
    const { asset_name, amount } = req.body;

    if (!asset_name || !amount) {
      return res
        .status(400)
        .json({ error: "Campos 'asset_name' e 'amount' são obrigatórios." });
    }

    // Chama a função ByUserId
    const result = await financeService.addInvestmentByUserId(
      userId,
      asset_name,
      amount
    );
    res.status(201).json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /investments
export const list = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!; // Pega o ID do Token

    // Chama a função ByUserId
    const investments = await financeService.listInvestmentsByUserId(userId);
    res.json(investments);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
