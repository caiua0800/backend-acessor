// src/specialists/financeSpecialist.ts
import * as financeService from '../services/financeService';
import * as aiService from '../services/aiService';
import { UserContext } from '../services/types';

interface TransactionData { amount: string; type: 'income' | 'expense'; category: string; description: string; date: string; }

// Função Auxiliar para garantir a limpeza da saída do LLM
function cleanJsonOutput(rawOutput: string): string {
    // 1. Tenta encontrar a primeira chave de JSON ({) e a última chave (})
    const start = rawOutput.indexOf('{');
    const end = rawOutput.lastIndexOf('}');
    
    // 2. Se as chaves forem encontradas, retorna o conteúdo entre elas.
    if (start !== -1 && end !== -1) {
        return rawOutput.substring(start, end + 1);
    }
    
    // 3. Se falhar, retorna o original (o JSON.parse() no bloco try/catch irá falhar, o que é o certo)
    return rawOutput;
}

export async function financeSpecialist(context: UserContext): Promise<string> {
    const { waId, fullMessage } = context;
    
    const extractionPrompt = `
        Você é um Extrator Financeiro. Extraia a transação.
        Retorne APENAS o JSON no formato: {"amount": "valor", "type": "income ou expense", "category": "Categoria", "description": "Detalhes", "date": "yyyy-MM-dd"}.
    `;

    try {
        const rawJsonString = await aiService.extractData(extractionPrompt, fullMessage);
        
        // 1. Limpeza do output para remover texto extra do LLM (Ex: "Claro, aqui está...")
        const jsonString = cleanJsonOutput(rawJsonString); 

        // 2. Tenta fazer o parse do JSON
        const transactionData: TransactionData = JSON.parse(jsonString);

        if (!transactionData.amount || !transactionData.type) return ""; 
        
        // 3. Execução do serviço
        const result = await financeService.addTransaction(waId, transactionData);
        
        return `💰 ${result}`;

    } catch (error) {
        // Se o LLM falhou no JSON.parse(), isso será pego aqui.
        console.error("Erro no JSON parse do Finance Specialist:", error);
        return "❌ Ocorreu um erro ao registrar sua transação. O sistema de IA não conseguiu extrair os dados. Tente novamente.";
    }
}