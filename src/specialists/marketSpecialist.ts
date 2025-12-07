// src/specialists/marketSpecialist.ts

import * as marketListService from "../services/marketListService";
import * as aiService from "../services/aiService";
import { UserContext, MarketItem } from "../services/types";

export async function marketSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage } = context;

  const extractionPrompt = `
        Você é um Extrator de Dados de Mercado. Analise o texto e extraia TODOS os itens de mercado/compras com suas quantidades.
        Se a quantidade não for mencionada, use 1. IGNORE TUDO QUE NÃO SEJA COMPRAS.
        Retorne APENAS o JSON, no formato: [{"itemName": "nome", "quantity": num}, ...].
    `;

  try {
    const jsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );

    // Se a IA não retornou JSON, esta linha falha e vai para o catch.
    const items: MarketItem[] = JSON.parse(jsonString);

    if (!items || items.length === 0) {
      // A IA não encontrou itens. Saída neutra.
      return "";
    }

    // --- PONTO CRÍTICO: CHAMA O SERVIÇO DE BANCO DE DADOS ---
    // Se este serviço falhar, o erro é propagado para o bloco catch.
    const addedItems = await marketListService.addMultipleItemsToList(
      waId,
      items
    );

    // Se chegamos aqui, o item foi salvo com SUCESSO.
    const itemsList = addedItems
      .map((item) => `${item.item_name} (${item.quantity})`)
      .join(", ");

    return `✅ Itens de mercado adicionados: ${itemsList}.`;
  } catch (error: any) {
    console.error("Erro no Market Specialist (Extração/DB):", error);

    // Se for erro de AUTENTICAÇÃO, ele deve ser tratado de forma diferente
    if (error.message.includes("AUTH_REQUIRED")) {
      // Retorna mensagem crítica (com *Parece que preciso...) para ser tratada no Orquestrador
      return "*Parece que preciso da sua permissão* para acessar a lista de compras. Por favor, autorize o acesso.";
    }

    // Em qualquer outro erro (JSON inválido, DB down, etc.), retornamos a mensagem de erro.
    return "❌ Ocorreu um erro ao adicionar itens à lista de compras. Verifique a conexão com o banco de dados ou a formatação da sua mensagem.";
  }
}
