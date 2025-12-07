import { Request, Response } from "express";
import * as listService from "../services/marketListService";

export const get = async (req: Request, res: Response) => {
    try {
        // MUDE de req.body.wa_id para req.query.wa_id
        const wa_id = req.query.wa_id as string; 
        if (!wa_id) {
            return res.status(400).json({ error: "wa_id é obrigatório na query." });
        }
        const items = await listService.getList(wa_id);
        res.json(items);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
};


export const add = async (req: Request, res: Response) => {
    try {
        const { wa_id, items } = req.body;
        let itemsToProcess = [];

        if (!items) {
            return res.status(400).json({ error: "O campo 'items' é obrigatório." });
        }

        // --- LÓGICA DE TOLERÂNCIA A ERRO ---
        // Se a IA mandou uma string em vez de um array (ex: "mandioca, ervilhas")
        if (typeof items === 'string') {
            console.log("⚠️ IA enviou string, convertendo para array...");
            // Quebra a string por vírgula e transforma em objetos
            itemsToProcess = items.split(',').map(name => ({
                itemName: name.trim(),
                quantity: 1 // Assume quantidade 1
            }));
        } 
        // Se for um array de objetos (o formato correto)
        else if (Array.isArray(items)) {
            itemsToProcess = items;
        } 
        else {
            return res.status(400).json({ error: "Formato de 'items' inválido. Deve ser um array de objetos." });
        }
        
        if (itemsToProcess.length === 0) {
            return res.status(400).json({ error: "A lista de itens não pode estar vazia." });
        }
        // --- FIM DA LÓGICA ---

        const addedItems = await listService.addMultipleItemsToList(wa_id, itemsToProcess);
        res.json({ message: "Itens adicionados com sucesso!", items: addedItems });
        
    } catch (e: any) { 
        res.status(500).json({ error: e.message }); 
    }
};

export const update = async (req: Request, res: Response) => {
  try {
    const { wa_id, new_quantity } = req.body;
    const { itemId } = req.params;
    const item = await listService.updateItemQuantity(
      wa_id,
      itemId,
      new_quantity
    );
    res.json({ message: "Quantidade atualizada!", item });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    const { wa_id } = req.body;
    const { itemId } = req.params;
    const result = await listService.removeItemFromList(wa_id, itemId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const clear = async (req: Request, res: Response) => {
  try {
    const result = await listService.clearList(req.body.wa_id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
