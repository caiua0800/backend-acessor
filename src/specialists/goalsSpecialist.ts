// src/specialists/goalsSpecialist.ts

import * as goalsService from "../services/goalsService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

// Interface para um item de ação de meta
interface GoalActionItem {
  action_type: "create" | "update_progress" | "delete" | "list";
  goal_name?: string;
  amount?: string;
  target_amount?: string;
  metric_unit?: string;
  category?: string;
  deadline?: string;
  description?: string;
}

// Interface principal da resposta da IA
interface GoalsIntention {
  intent: string;
  items?: GoalActionItem[];
  // Campos legados
  goal_name?: string;
  amount?: string;
  target_amount?: string;
  metric_unit?: string;
  category?: string;
  deadline?: string;
  delete?: boolean;
  list_all?: boolean;
}

// --- SUB-ESPECIALISTA: ENCONTRAR META CERTA ---
async function findBestGoalMatch(
  userMessage: string,
  failedGoalName: string,
  availableGoals: any[]
): Promise<string | null> {
  if (availableGoals.length === 0) return null;

  const goalsListString = availableGoals
    .map(
      (g) =>
        `- "${g.goal_name}" (Categoria: ${g.category}, Alvo: ${g.target_amount})`
    )
    .join("\n");

  const prompt = `
    Você é um 'Matcher' de Metas. O usuário tentou atualizar a meta "${failedGoalName}", mas ela não existe no banco exato.
    
    MENSAGEM DO USUÁRIO: "${userMessage}"
    
    METAS EXISTENTES NO BANCO:
    ${goalsListString}
    
    SUA TAREFA:
    Analise a mensagem e as metas existentes. Qual das metas existentes é a mais provável que o usuário esteja se referindo?
    
    REGRAS:
    - Retorne APENAS um JSON.
    - Se encontrar uma correspondência clara (mesmo que o nome seja diferente, mas o contexto bata), retorne: { "found": true, "correct_name": "NOME_EXATO_DA_LISTA" }
    - Se não tiver certeza absoluta, retorne: { "found": false }
  `;

  try {
    const rawJson = await aiService.extractData(prompt, userMessage); // Usamos a msg como input mas o prompt tem o contexto

    const start = rawJson.indexOf("{");
    const end = rawJson.lastIndexOf("}");
    if (start === -1 || end === -1) return null;

    const jsonStr = rawJson.substring(start, end + 1);
    const result = JSON.parse(jsonStr);

    if (result.found && result.correct_name) {
      console.log(
        `🎯 [GOALS MATCH] IA Corrigiu: "${failedGoalName}" -> "${result.correct_name}"`
      );
      return result.correct_name;
    }
    return null;
  } catch (e) {
    console.error("Erro no Goal Matcher:", e);
    return null;
  }
}

// Limpeza robusta de JSON
function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    return rawOutput.substring(start, end + 1);
  }
  return rawOutput;
}

export async function goalsSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  const extractionPrompt = `
    Você é um Gerente de Metas. Analise a mensagem e extraia as ações em JSON.

    AÇÕES POSSÍVEIS ("action_type"):
    1. "create": Criar nova meta. (Ex: "Criar meta de 100k")
    2. "update_progress": Atualizar progresso. (Ex: "Consegui mais 500", "Já tenho 100 mil")
    3. "delete": Excluir meta.
    4. "list": Listar metas.

    REGRAS CRÍTICAS:
    - Se houver MÚLTIPLAS ações, use o array "items".
    - "deadline": Se o usuário disser "até 2027", use "2027-12-31".
    
    EXEMPLO DE RESPOSTA (JSON OBRIGATÓRIO):
    {
      "intent": "manage_goals",
      "items": [
        { "action_type": "update_progress", "goal_name": "...", "amount": "..." }
      ]
    }
  `;

  try {
    // 1. EXTRAÇÃO
    const rawJsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const jsonString = cleanJsonOutput(rawJsonString);
    const data: GoalsIntention = JSON.parse(jsonString);

    console.log(
      "🎯 [GOALS DEBUG] JSON Extraído:",
      JSON.stringify(data, null, 2)
    );

    let resultsMessages: string[] = [];
    let isFinancialProgress = false;

    // 2. NORMALIZAÇÃO
    let itemsToProcess: GoalActionItem[] = [];
    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      itemsToProcess = data.items;
    } else {
      let type: any = null;
      if (data.list_all) type = "list";
      else if (data.delete && data.goal_name) type = "delete";
      else if (data.goal_name && data.amount) type = "update_progress";
      else if (data.goal_name && data.target_amount) type = "create";

      if (type) {
        itemsToProcess.push({
          action_type: type,
          goal_name: data.goal_name,
          amount: data.amount,
          target_amount: data.target_amount,
          metric_unit: data.metric_unit,
          category: data.category,
          deadline: data.deadline,
        });
      }
    }

    if (itemsToProcess.length === 0) return "";

    // 3. PROCESSAMENTO
    for (const item of itemsToProcess) {
      try {
        // A. LISTAR
        if (item.action_type === "list") {
          const goals = await goalsService.listGoals(waId);
          if (goals.length === 0) {
            resultsMessages.push("Você não tem metas cadastradas.");
          } else {
            const listText = goals
              .map(
                (g) =>
                  `*${g.goal_name}*: ${g.current_progress}/${g.target_amount} (${g.progress_percent}%)`
              )
              .join("\n");
            resultsMessages.push(`📋 Suas metas:\n${listText}`);
          }
        }

        // B. EXCLUIR
        else if (item.action_type === "delete" && item.goal_name) {
          // Tenta deletar direto
          try {
            await goalsService.deleteGoalByName(waId, item.goal_name);
            resultsMessages.push(`🗑️ Meta '${item.goal_name}' excluída.`);
          } catch (delError: any) {
            // Retry de Delete (opcional, mesma lógica do update se quiser)
            throw delError;
          }
        }

        // C. ATUALIZAR PROGRESSO (COM RETRY INTELIGENTE)
        else if (
          item.action_type === "update_progress" &&
          item.goal_name &&
          item.amount
        ) {
          let goalNameToUse = item.goal_name;
          let updated = null;

          try {
            // TENTATIVA 1: Nome exato ou parcial via ILIKE (SQL)
            updated = await goalsService.updateGoalProgress(
              waId,
              goalNameToUse,
              item.amount,
              item.description
            );
          } catch (firstError: any) {
            // Se falhou pq não achou...
            if (firstError.message.includes("não encontrada")) {
              console.log(
                `⚠️ [GOALS] Meta '${goalNameToUse}' não achada. Acionando IA Matcher...`
              );

              // 1. Busca todas as metas reais
              const allGoals = await goalsService.listGoals(waId);

              // 2. Chama a IA Sub-especialista
              const matchedName = await findBestGoalMatch(
                fullMessage,
                goalNameToUse,
                allGoals
              );

              if (matchedName) {
                // TENTATIVA 2: Com o nome corrigido pela IA
                goalNameToUse = matchedName;
                updated = await goalsService.updateGoalProgress(
                  waId,
                  goalNameToUse,
                  item.amount,
                  item.description
                );
              } else {
                // Se a IA também não achou, desiste e joga o erro original
                throw firstError;
              }
            } else {
              throw firstError;
            }
          }

          if (updated) {
            if (
              updated.metric_unit.includes("R$") ||
              updated.metric_unit.includes("$")
            ) {
              isFinancialProgress = true;
            }
            resultsMessages.push(
              `✅ Progresso em '${updated.goal_name}': +${item.amount}. Total: ${updated.current_progress}/${updated.target_amount} (${updated.progress_percent}%).`
            );
          }
        }

        // D. CRIAR META
        else if (
          item.action_type === "create" &&
          item.goal_name &&
          item.target_amount
        ) {
          const newGoal = await goalsService.createGoal(waId, {
            goal_name: item.goal_name,
            target_amount: item.target_amount,
            metric_unit: item.metric_unit || "Unid",
            category: item.category || "Geral",
            deadline: item.deadline,
          });
          resultsMessages.push(
            `🌟 Meta '${newGoal.goal_name}' criada! Alvo: ${newGoal.target_amount}.`
          );
        }
      } catch (innerError: any) {
        console.error(`Erro ao processar item ${item.goal_name}:`, innerError);
        resultsMessages.push(
          `❌ Não consegui processar '${item.goal_name || "item"}': ${
            innerError.message
          }`
        );
      }
    }

    if (resultsMessages.length === 0) return "";

    // 4. RESPOSTA FINAL
    const combinedMessage = resultsMessages.join("\n\n");
    let systemInstruction = `Transforme este resumo técnico em uma resposta única e motivadora: "${combinedMessage}"`;

    if (isFinancialProgress) {
      systemInstruction += `\n*PERGUNTE:* "Quer lançar esses valores como saída/entrada no financeiro também?"`;
    }

    return await aiService.generatePersonaResponse(
      systemInstruction,
      fullMessage,
      userConfig
    );
  } catch (error: any) {
    console.error(`❌ [GOALS ERROR]:`, error);
    return `Ocorreu um erro ao processar suas metas: ${error.message}`;
  }
}
