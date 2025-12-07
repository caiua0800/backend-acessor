// src/specialists/financeSpecialist.ts
import * as financeService from "../services/financeService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

interface TransactionData {
  amount: string;
  type: "income" | "expense";
  category: string;
  description: string;
  date: string;
}

// Função Auxiliar para garantir a limpeza da saída do LLM
function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    return rawOutput.substring(start, end + 1);
  }
  return rawOutput;
}

export async function financeSpecialist(context: UserContext): Promise<any> {
  // RETORNA ANY (JSON)
  const { waId, fullMessage } = context;

  const extractionPrompt = `
        Você é um Extrator Financeiro. Extraia uma transação.
        Retorne APENAS o JSON no formato: {"amount": "valor", "type": "income ou expense", "category": "Categoria", "description": "Detalhes", "date": "yyyy-MM-dd"}.
    `;

  try {
    const rawJsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const jsonString = cleanJsonOutput(rawJsonString);

    const transactionData: TransactionData = JSON.parse(jsonString);

    if (!transactionData.amount || !transactionData.type)
      return { task: "finance", status: "NOT_APPLICABLE" };

    // A função addTransaction retorna a mensagem formatada de sucesso
    const result: string = await financeService.addTransaction(
      waId,
      transactionData
    );

    // A mensagem de sucesso (result) já contém os detalhes da transação
    return {
      task: "finance",
      status: "SUCCESS",
      action: "add_transaction",
      message: result,
    };
  } catch (error) {
    return {
      task: "finance",
      status: "FAILURE",
      reason: (error as any).message,
    };
  }
}
