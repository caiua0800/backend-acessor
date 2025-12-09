// src/specialists/marketSpecialist.ts

import * as marketListService from "../services/marketListService";
import * as aiService from "../services/aiService";
import { UserContext, MarketItem } from "../services/types";

// Interfaces
interface ListData {
  list_all: boolean;
}
interface DeleteData {
  item_name: string;
  delete: boolean;
}
interface ClearData {
  clear_all: boolean;
}
type MarketExtractionData = MarketItem[] | ListData | DeleteData | ClearData;

// --- FUNÇÃO DE LIMPEZA (IMPORTANTE PARA EVITAR ERROS DE PARSE) ---
function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("["); // Procura início de Array
  const startObj = rawOutput.indexOf("{"); // Procura início de Objeto

  // Decide quem vem primeiro (para saber se é array ou objeto)
  let startIndex = -1;
  if (start !== -1 && startObj !== -1) {
    startIndex = start < startObj ? start : startObj;
  } else if (start !== -1) {
    startIndex = start;
  } else {
    startIndex = startObj;
  }

  const end = rawOutput.lastIndexOf("]");
  const endObj = rawOutput.lastIndexOf("}");

  let endIndex = -1;
  if (end !== -1 && endObj !== -1) {
    endIndex = end > endObj ? end : endObj;
  } else if (end !== -1) {
    endIndex = end;
  } else {
    endIndex = endObj;
  }

  if (startIndex !== -1 && endIndex !== -1) {
    return rawOutput.substring(startIndex, endIndex + 1);
  }
  return rawOutput;
}

export async function marketSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  const extractionPrompt = `
    Você é um Extrator de Ações de Mercado. Analise a mensagem e retorne APENAS o JSON.
    
    ### REGRAS CRÍTICAS ###
    1. ADICIONAR: Retorne um ARRAY: [ {"itemName": "nome", "quantity": num}, ... ]
    2. LISTAR: Retorne: {"list_all": true}
    3. EXCLUIR: Retorne: {"item_name": "Nome do Item", "delete": true}
    4. LIMPAR: Retorne: {"clear_all": true}
    5. Nenhuma das anteriores: retorne objeto vazio {}
  `;

  try {
    // 1. EXTRAÇÃO
    const rawJsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );

    // LOG 1: O que a IA mandou cru?
    console.log("🛒 [MARKET RAW IA]:", rawJsonString);

    const jsonString = cleanJsonOutput(rawJsonString);
    const data: MarketExtractionData = JSON.parse(jsonString);

    // LOG 2: O que entendemos após o parse?
    console.log("🛒 [MARKET PARSED]:", JSON.stringify(data, null, 2));

    let actionConfirmedMessage = "";

    // 2. LÓGICA DE EXECUÇÃO

    // --- LIMPAR TUDO ---
    if ("clear_all" in data && (data as ClearData).clear_all) {
      console.log("🛒 [MARKET ACTION] Limpando lista...");
      await marketListService.clearList(waId);
      actionConfirmedMessage = "Sua lista de compras foi limpa.";
    }

    // --- LISTAR ---
    else if ("list_all" in data && (data as ListData).list_all) {
      console.log("🛒 [MARKET ACTION] Listando itens...");
      const listItems = await marketListService.getList(waId);
      if (listItems.length === 0) {
        actionConfirmedMessage = "Sua lista de compras está vazia.";
      } else {
        const listText = listItems
          .map((item) => `${item.quantity}x ${item.item_name}`)
          .join(", ");
        actionConfirmedMessage = `Sua lista de compras contém: ${listText}.`;
      }
    }

    // --- EXCLUIR ITEM ---
    else if (
      "delete" in data &&
      (data as DeleteData).delete &&
      (data as DeleteData).item_name
    ) {
      const itemToDelete = (data as DeleteData).item_name;
      console.log(`🛒 [MARKET ACTION] Deletando item: ${itemToDelete}`);
      const deleteResult = await marketListService.removeItemByName(
        waId,
        itemToDelete
      );
      actionConfirmedMessage = `Removido: ${itemToDelete}.`;
    }

    // --- ADICIONAR (ARRAY) ---
    else if (Array.isArray(data) && data.length > 0) {
      console.log("🛒 [MARKET ACTION] Adicionando Itens:", data);
      const itemsToAdd = data as MarketItem[];

      const addedItems = await marketListService.addMultipleItemsToList(
        waId,
        itemsToAdd
      );

      const addedText = addedItems
        .map((item) => `${item.quantity}x ${item.item_name}`)
        .join(", ");
      console.log("🛒 [MARKET SUCCESS] Itens salvos no DB:", addedText);

      actionConfirmedMessage = `Adicionado à lista: ${addedText}.`;
    }

    // --- FALHA/IGNORADO ---
    else {
      console.log("🛒 [MARKET SKIP] Nenhuma ação válida identificada no JSON.");
    }

    if (!actionConfirmedMessage) {
      return "";
    }

    // 3. RESPOSTA FINAL
    return await aiService.generatePersonaResponse(
      `Confirme esta ação de mercado de forma amigável: "${actionConfirmedMessage}"`,
      fullMessage,
      userConfig
    );
  } catch (error: any) {
    console.error(`❌ [MARKET ERROR]:`, error);
    return `Tive um erro ao acessar a lista: ${error.message}`;
  }
}
