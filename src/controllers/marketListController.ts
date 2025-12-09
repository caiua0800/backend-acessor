import { Request, Response } from "express";
import * as listService from "../services/marketListService";
import { AuthRequest } from "../middlewares/authMiddleware";

// GET /market-list
export const get = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const items = await listService.getListByUserId(userId);
    res.json(items);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// POST /market-list
export const add = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { items } = req.body;
    let itemsToProcess = [];

    if (!items) {
      return res.status(400).json({ error: "O campo 'items' é obrigatório." });
    }

    // --- LÓGICA DE TRATAMENTO DE ENTRADA DA API (Melhor que tolerância a erros) ---
    if (typeof items === "string") {
      itemsToProcess = items.split(",").map((name) => ({
        itemName: name.trim(),
        quantity: 1,
      }));
    } else if (Array.isArray(items)) {
      // Garante que o array não está vazio e tem o formato correto
      itemsToProcess = items.filter(
        (item) => item.itemName && item.quantity > 0
      );
    }

    if (itemsToProcess.length === 0) {
      return res
        .status(400)
        .json({
          error: "A lista de itens está vazia ou no formato incorreto.",
        });
    }
    // --- FIM DA LÓGICA ---

    const addedItems = await listService.addMultipleItemsToListByUserId(
      userId,
      itemsToProcess
    );
    res.json({ message: "Itens adicionados com sucesso!", items: addedItems });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// PUT /market-list/:itemId
export const update = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { itemId } = req.params;
    const { new_quantity } = req.body;

    if (new_quantity === undefined || isNaN(parseInt(new_quantity))) {
      return res.status(400).json({ error: "A nova quantidade é inválida." });
    }

    const item = await listService.updateItemQuantityByUserId(
      userId,
      itemId,
      parseInt(new_quantity)
    );

    if (!item) return res.status(404).json({ error: "Item não encontrado." });

    res.json({ message: "Quantidade atualizada!", item });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// DELETE /market-list/:itemId
export const remove = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { itemId } = req.params;

    const result = await listService.removeItemFromListByUserId(userId, itemId);

    if (result.deleted_count === 0)
      return res
        .status(404)
        .json({ error: "Item não encontrado para remoção." });

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// DELETE /market-list
export const clear = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const result = await listService.clearListByUserId(userId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
