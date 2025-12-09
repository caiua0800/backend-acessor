
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
import { vaultSpecialist } from "../specialists/vaultSpecialist";
import { generalSpecialist } from "../specialists/generalSpecialist";
import { gymSpecialist } from "../specialists/gymSpecialist";
import { todoSpecialist } from "../specialists/todoSpecialist";

// Mapeamento de keywords para as funções de especialista
// O retorno agora é Promise<string>
const specialistMap: Record<string, (context: UserContext) => Promise<string>> = {
  market: marketSpecialist as (context: UserContext) => Promise<string>,
  ideas: ideasSpecialist as (context: UserContext) => Promise<string>,
  calendar: calendarSpecialist as (context: UserContext) => Promise<string>,
  goals: goalsSpecialist as (context: UserContext) => Promise<string>,
  finance: financeSpecialist as (context: UserContext) => Promise<string>,
  email: gmailSpecialist as (context: UserContext) => Promise<string>,
  files: fileManagerSpecialist as (context: UserContext) => Promise<string>,
  vault: vaultSpecialist as (context: UserContext) => Promise<string>,
  gym: gymSpecialist as (context: UserContext) => Promise<string>,
  todo: todoSpecialist as (context: UserContext) => Promise<string>,

};

// =================================================================
// O MOTOR DE ORQUESTRAÇÃO PRINCIPAL
// =================================================================
export async function processAndOrchestrate(
  context: UserContext
): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  // NOVO: 1. CARREGA O HISTÓRICO DE CONVERSA DO DB PARA O DISPATCH
  const chatHistoryText = await memoryService.loadHistory(waId);

  // 2. PASSO DE DISPATCH: Identifica as intenções
  // MODIFICADO: Passa o histórico para a função
  const keywords = await aiService.identifyTasks(fullMessage, chatHistoryText); 
  console.log(
    `🤖 Agente Despachante identificou as tarefas: ${keywords.join(", ")}`
  );

  // 3. TRATAMENTO DA CONVERSA GERAL
  const isGeneralConversation =
    keywords.includes("general") || keywords.length === 0;

  if (isGeneralConversation) {
    return generalSpecialist(context);
  }

  // 4. PASSO DE ORQUESTRAÇÃO PARALELA
  // Filtra e executa apenas os especialistas necessários
  const specialistPromises = keywords
    .filter((k) => specialistMap[k])
    .map((keyword) => specialistMap[keyword](context));

  // Fallback de segurança (caso a keyword exista mas não esteja no mapa)
  if (specialistPromises.length === 0) {
    return generalSpecialist(context);
  }

  // Executa todos em paralelo e aguarda os resultados (que são strings)
  const results: string[] = await Promise.all(specialistPromises);

  // 5. FILTRAGEM DE RESPOSTAS VÁLIDAS
  const validResponses = results.filter((res) => typeof res === 'string' && res.length > 0);

  // 6. TRATAMENTO DE FALHA GERAL
  if (validResponses.length === 0) {
    return generalSpecialist(context);
  }

  // 7. UNIFICAÇÃO (SUMMARIZER)
  const finalMessage = await aiService.summarizerResponse(
    validResponses,
    userConfig
  );

  // 8. SALVA A RESPOSTA FINAL NO HISTÓRICO
  await memoryService.saveToHistory(waId, fullMessage, finalMessage);

  return finalMessage;
}