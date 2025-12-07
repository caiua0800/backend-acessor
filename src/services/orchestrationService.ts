// src/services/orchestrationService.ts (AJUSTADO PARA JSON)

import * as aiService from "./aiService";
import { UserContext } from "./types";
import * as memoryService from "./memoryService";

// ----------------------------------------------------------------
// IMPORTS DOS ESPECIALISTAS
// ----------------------------------------------------------------
import { marketSpecialist } from "../specialists/marketSpecialist";
import { ideasSpecialist } from "../specialists/ideasSpecialist";
import { calendarSpecialist } from "../specialists/calendarSpecialist";
import { goalsSpecialist } from "../specialists/goalsSpecialist";
import { financeSpecialist } from "../specialists/financeSpecialist";
import { gmailSpecialist } from "../specialists/gmailSpecialist";
import { fileManagerSpecialist } from "../specialists/fileManagerSpecialist";

// Mapeamento de keywords para as funções de especialista
const specialistMap: Record<string, (context: UserContext) => Promise<any>> = {
  // Promise<any> pois retorna JSON
  market: marketSpecialist,
  ideas: ideasSpecialist,
  calendar: calendarSpecialist,
  goals: goalsSpecialist,
  finance: financeSpecialist,
  email: gmailSpecialist,
  files: fileManagerSpecialist,
};

// =================================================================
// ESPECIALISTA DE CONVERSA GERAL (Permanece igual)
// =================================================================
export async function generalSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  const chatHistoryText = await memoryService.loadHistory(waId);

  const systemMessage = `
        ===[SISTEMA: Data Atual: ${aiService.getSaoPauloTime()}]\n
        Você é um assistente pessoal. Sua identidade é:
        - Nome: ${userConfig.agent_nickname}
        - Gênero: ${userConfig.agent_gender}
        - Personalidade: ${userConfig.agent_personality.join(", ")}
        
        Você está conversando com ${userConfig.user_nickname}.
        
        ### SUA MISSÃO CRÍTICA ###
        Sua única tarefa é conversar e entreter.
        
        ### REGRA DE PROIBIÇÃO (MÁXIMA PRIORIDADE) ###
        1. VOCÊ NÃO TEM FERRAMENTAS.
        2. NUNCA mencione ter agendado, pausado, adicionado itens, etc.
        
        ### HISTÓRICO DE CONVERSA (PARA CONTEXTO) ###
        ${chatHistoryText}
        
        Aja com sua personalidade e responda à última mensagem.
    `;

  try {
    const responseText = await aiService.generalCompletion(
      systemMessage,
      fullMessage
    );

    await memoryService.saveToHistory(waId, fullMessage, responseText);

    return responseText;
  } catch (error) {
    console.error("Erro no General Specialist:", error);
    return "Desculpe, tive um problema de comunicação, mas estou de volta! Manda de novo.";
  }
}

// =================================================================
// O MOTOR DE ORQUESTRAÇÃO PRINCIPAL
// =================================================================
export async function processAndOrchestrate(
  context: UserContext
): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  // 1. PASSO DE DISPATCH
  const keywords = await aiService.identifyTasks(fullMessage);
  console.log(
    `🤖 Agente Despachante identificou as tarefas: ${keywords.join(", ")}`
  );

  // 2. TRATAMENTO DA CONVERSA GERAL
  const isGeneralConversation =
    keywords.includes("general") || keywords.length === 0;

  if (isGeneralConversation) {
    return generalSpecialist(context);
  }

  // 3. PASSO DE ORQUESTRAÇÃO PARALELA
  const specialistPromises = keywords
    .filter((k) => specialistMap[k])
    .map((keyword) => specialistMap[keyword](context));

  if (specialistPromises.length === 0) {
    return generalSpecialist(context);
  }

  // 4. SINCRONIZAÇÃO: Executa TUDO e coleta os JSONs Técnicos
  const technicalResults: any[] = await Promise.all(specialistPromises);

  // 5. COLETA DE ERROS CRÍTICOS E AUTENTICAÇÃO
  const authError = technicalResults.find(
    (res) => res.status === "FAILURE" && res.reason === "AUTH_REQUIRED"
  );
  const allFailures = technicalResults.filter(
    (res) => res.status === "FAILURE"
  );

  if (authError) {
    // Assume que o erro de AUTH_REQUIRED já contém o link no 'detail'
    return allFailures.map((f) => f.detail).join("\n\n");
  }

  // 6. TRATAMENTO DE FALHA
  if (technicalResults.every((res) => res.status !== "SUCCESS")) {
    // Se NENHUMA tarefa foi sucesso, resumimos os erros.
    if (allFailures.length > 0) {
      const errorDetails = allFailures.map((f) => f.detail).join("; ");
      return `*Desculpe, não consegui completar as tarefas devido a um erro:* ${errorDetails}`;
    }
    return generalSpecialist(context);
  }

  // 7. AGENTE DE FORMATAÇÃO (JSON -> VOZ FINAL)
  const finalMessage = await aiService.formatFinalResponse(
    technicalResults,
    userConfig
  );

  // 8. SALVA A RESPOSTA FINAL NO HISTÓRICO
  await memoryService.saveToHistory(waId, fullMessage, finalMessage);

  return finalMessage;
}
