import { Request, Response } from "express";
import * as financeService from "../services/financeService";
import { AuthRequest } from "../middlewares/authMiddleware";

// POST /investments (MANTIDO)
export const add = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { asset_name, amount } = req.body;

    if (!asset_name || !amount) {
      return res
        .status(400)
        .json({ error: "Campos 'asset_name' e 'amount' são obrigatórios." });
    }

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

// GET /investments (RESUMO - MANTIDO)
export const list = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const investments = await financeService.listInvestmentsByUserId(userId);
    res.json(investments);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// NOVO: GET /investments/search?page=1&limit=10&name=Tesouro
export const search = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const page = parseInt((req.query.page as string) || "1");
    const limit = parseInt((req.query.limit as string) || "20");
    const nameFilter = req.query.name as string | undefined;

    if (limit > 100)
      return res.status(400).json({ error: "Limite máximo de 100 itens." });

    const offset = (page - 1) * limit;

    const result = await financeService.searchInvestmentsByUserId(
      userId,
      limit,
      offset,
      nameFilter
    );

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// NOVO: PUT /investments/:id
export const update = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const { asset_name, amount } = req.body;

    const updated = await financeService.updateInvestmentByUserId(
      userId,
      id,
      asset_name,
      amount
    );

    if (!updated) {
      return res.status(404).json({ error: "Investimento não encontrado." });
    }

    res.json({ message: "Investimento atualizado!", investment: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// NOVO: DELETE /investments/:id
export const remove = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const deleted = await financeService.deleteInvestmentByUserId(userId, id);

    if (!deleted) {
      return res.status(404).json({ error: "Investimento não encontrado." });
    }

    res.json({ message: "Investimento removido com sucesso." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
