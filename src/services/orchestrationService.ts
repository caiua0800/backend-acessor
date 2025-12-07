// src/services/orchestrationService.ts

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
const specialistMap: Record<string, (context: UserContext) => Promise<string>> =
  {
    market: marketSpecialist,
    ideas: ideasSpecialist,
    calendar: calendarSpecialist,
    goals: goalsSpecialist,
    finance: financeSpecialist,
    email: gmailSpecialist,
    files: fileManagerSpecialist,
  };

// =================================================================
// 3. ESPECIALISTA DE CONVERSA GERAL
// =================================================================

/**
 * Especialista de Conversa Geral.
 * Usa o histórico de chat para manter a conversa.
 */
export async function generalSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  // 1. CARREGA O HISTÓRICO DE CONVERSA DO DB
  const chatHistoryText = await memoryService.loadHistory(waId);

  // 2. MONTA O PROMPT COMPLETO
  const systemMessage = `
        ===[SISTEMA: Data Atual: ${aiService.getSaoPauloTime()}]\n
        Você é um assistente pessoal. Sua identidade é:
        - Nome: ${userConfig.agent_nickname}
        - Gênero: ${userConfig.agent_gender}
        - Personalidade: ${userConfig.agent_personality.join(", ")}
        
        Você está conversando com ${userConfig.user_nickname}.
        
        ### SUA MISSÃO ###
        Sua missão é agir como um especialista em conversa geral. Sua única tarefa é conversar, entreter e ser um bom companheiro, mantendo sua personalidade. Você não tem ferramentas. Se o usuário pedir para fazer algo, diga a ele para pedir novamente de forma mais direta.
        
        ### HISTÓRICO DE CONVERSA (PARA CONTEXTO) ###
        ${chatHistoryText}
        
        Aja com sua personalidade e responda à última mensagem.
    `;

  try {
    // 3. CHAMA O LLM (USA O MODELO DE RACIOCÍNIO)
    const responseText = await aiService.generalCompletion(
      systemMessage,
      fullMessage
    );

    // 4. SALVA A TROCA DE MENSAGENS NO HISTÓRICO
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

  // 1. PASSO DE DISPATCH (Agente Despachante)
  const keywords = await aiService.identifyTasks(fullMessage);
  console.log(
    `🤖 Agente Despachante identificou as tarefas: ${keywords.join(", ")}`
  );

  // 2. CORREÇÃO: TRATAMENTO DA CONVERSA GERAL/VAZIO
  const isGeneralConversation =
    keywords.includes("general") || keywords.length === 0;

  if (isGeneralConversation) {
    return generalSpecialist(context);
  }

  // 3. PASSO DE ORQUESTRAÇÃO PARALELA (APENAS PARA TAREFAS ESPECÍFICAS)
  const specialistPromises = keywords
    .filter((k) => specialistMap[k]) // Filtra apenas as keywords que estão no nosso mapa
    .map((keyword) => specialistMap[keyword](context));

  if (specialistPromises.length === 0) {
    return generalSpecialist(context);
  }

  // 4. SINCRONIZAÇÃO: Executa TUDO em paralelo e espera o resultado
  const results: string[] = await Promise.all(specialistPromises);

  // 5. LIMPEZA E TRATAMENTO DE ERRO/AUTENTICAÇÃO
  const successResponses = results.filter((r) => r && r.startsWith("✅"));
  const errorResponses = results.filter((r) => r && r.startsWith("❌"));
  const criticalMessages = results.filter((r) =>
    r.includes("*Parece que preciso da sua permissão")
  );

  if (criticalMessages.length > 0) {
    return criticalMessages.join("\n\n");
  }

  if (successResponses.length === 0) {
    if (errorResponses.length > 0) {
      const errorText = errorResponses
        .map((e) => e.replace("❌ ", ""))
        .join("\n\n");
      return `*Desculpe, não consegui completar todas as tarefas:*\n${errorText}`;
    }
    return generalSpecialist(context);
  }

  // 6. PASSO DE SUMARIZAÇÃO (Agente Resumidor)
  const finalMessage = await aiService.summarizeResponses(
    successResponses,
    userConfig
  );

  // 7. SALVA A RESPOSTA FINAL NO HISTÓRICO
  await memoryService.saveToHistory(waId, fullMessage, finalMessage);

  return finalMessage;
}
