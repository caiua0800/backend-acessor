
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
import { studySpecialist } from "../specialists/studySpecialist";

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
  study: studySpecialist as (context: UserContext) => Promise<string>, 
};

// =================================================================
// O MOTOR DE ORQUESTRAÇÃO PRINCIPAL
// =================================================================
export async function processAndOrchestrate(
  context: UserContext
): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  // 1. CARREGA O HISTÓRICO
  const chatHistoryText = await memoryService.loadHistory(waId);

  // 2. PASSO DE DISPATCH
  const keywords = await aiService.identifyTasks(fullMessage, chatHistoryText); 
  console.log(`🤖 Agente Despachante identificou as tarefas: ${keywords.join(", ")}`);

  const isGeneralConversation = keywords.includes("general") || keywords.length === 0;

  if (isGeneralConversation) {
    // 3. Roda General
    const finalResponse = await generalSpecialist(context);
    await memoryService.saveToHistory(waId, fullMessage, finalResponse);
    return finalResponse;
  }

  // 4. ORQUESTRAÇÃO PARALELA
  const specialistPromises = keywords
    .filter((k) => specialistMap[k])
    .map((keyword) => specialistMap[keyword](context));

  if (specialistPromises.length === 0) {
    const finalResponse = await generalSpecialist(context);
    await memoryService.saveToHistory(waId, fullMessage, finalResponse);
    return finalResponse;
  }

  const results: string[] = await Promise.all(specialistPromises);

  // 5. FILTRAGEM
  const validResponses = results.filter((res) => typeof res === 'string' && res.length > 0);

  if (validResponses.length === 0) {
    const finalResponse = await generalSpecialist(context);
    await memoryService.saveToHistory(waId, fullMessage, finalResponse);
    return finalResponse;
  }

  // 6. UNIFICAÇÃO
  const finalMessage = await aiService.summarizerResponse(
    validResponses,
    userConfig
  );

  // 7. SALVA HISTÓRICO
  await memoryService.saveToHistory(waId, fullMessage, finalMessage);

  // CRÍTICO: Não enviamos a mensagem aqui, apenas a retornamos.
  // O Controller é quem envia.
  return finalMessage;
}