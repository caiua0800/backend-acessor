// src/specialists/marketSpecialist.ts
import * as marketListService from "../services/marketListService";
import * as aiService from "../services/aiService";
import { UserContext, MarketItem } from "../services/types";

// Interfaces para a IA retornar
interface ListData { list_all: boolean; }
interface DeleteData { item_name: string; delete: boolean; }
interface ClearData { clear_all: boolean; }

// Tipos de dados que o especialista pode extrair (para adicionar)
type MarketExtractionData = MarketItem[] | ListData | DeleteData | ClearData;

export async function marketSpecialist(context: UserContext): Promise<any> {
  const { waId, fullMessage } = context;

  // Prompt MESTRE DE INTENÇÃO: A IA deve retornar a ação e os dados
  const extractionPrompt = `
    Você é um Extrator de Ações de Mercado. Analise a mensagem e retorne APENAS um ÚNICO OBJETO JSON que melhor representa a intenção primária do usuário.
    
    ### REGRAS CRÍTICAS ###
    1. ADICIONAR: Se for adicionar, retorne um ARRAY de itens: [ {"itemName": "nome", "quantity": num}, ... ]
    2. LISTAR: Se for listar, retorne: {"list_all": true}
    3. EXCLUIR: Se for excluir um item, retorne: {"item_name": "Nome do Item", "delete": true}
    4. LIMPAR: Se for limpar a lista inteira, retorne: {"clear_all": true}
    5. Nenhuma das anteriores: retorne um objeto vazio: {}
  `;

  try {
    const jsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const data: MarketExtractionData = JSON.parse(jsonString);

    // --- 1. LÓGICA DE LIMPAR TUDO ---
    if ('clear_all' in data && data.clear_all) {
        await marketListService.clearList(waId);
        return { task: "market", status: "SUCCESS", action: "clear_all" };
    }

    // --- 2. LÓGICA DE LISTAR ---
    if ('list_all' in data && data.list_all) {
        const listItems = await marketListService.getList(waId);
        if (listItems.length === 0) {
            return { task: "market", status: "SUCCESS", action: "list", message: "Sua lista de compras está vazia." };
        }
        return { task: "market", status: "SUCCESS", action: "list", items: listItems };
    }
    
    // --- 3. LÓGICA DE EXCLUIR UM ITEM ---
    if ('delete' in data && data.delete && data.item_name) {
        const deleteResult = await marketListService.removeItemByName(waId, data.item_name);
        if (deleteResult.deleted_count > 0) {
            return { task: "market", status: "SUCCESS", action: "delete", item_name: data.item_name, deleted_count: deleteResult.deleted_count };
        }
        throw new Error(`Item '${data.item_name}' não encontrado para exclusão.`);
    }

    // --- 4. LÓGICA DE ADICIONAR (Se for um Array de itens) ---
    if (Array.isArray(data) && data.length > 0) {
      const addedItems = await marketListService.addMultipleItemsToList(waId, data as MarketItem[]);

      return {
        task: "market",
        status: "SUCCESS",
        action: "add",
        items: addedItems.map((item) => ({
          name: item.item_name,
          quantity: item.quantity,
        })),
      };
    }

    // --- 5. NENHUMA INTENÇÃO VÁLIDA ---
    return { task: "market", status: "NOT_APPLICABLE" }; 

  } catch (error: any) {
    // Retorno Técnico de FALHA (Incluindo a lógica de AUTH)
    return {
      task: "market",
      status: "FAILURE",
      reason: error.message.includes("AUTH_REQUIRED")
        ? "AUTH_REQUIRED"
        : "DB_ERROR",
      detail: error.message,
    };
  }
}