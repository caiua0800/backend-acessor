// src/specialists/goalsSpecialist.ts

import * as goalsService from "../services/goalsService";
import * as aiService from "../services/aiService";
import * as memoryService from "../services/memoryService"; // Importante para contexto
import { UserContext } from "../services/types";

// Interface para um item de ação de meta
interface GoalActionItem {
  action_type: "create" | "update_progress" | "delete" | "list";
  goal_name?: string;
  amount?: string;
  target_amount?: string;
  metric_unit?: string;
  category?: string;
  deadline?: string; // Pode vir "PERGUNTAR_DIA"
  description?: string;
}

// Interface principal da resposta da IA
interface GoalsIntention {
  intent: string;
  items?: GoalActionItem[];
  // Campos legados (fallback)
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
    METAS EXISTENTES:
    ${goalsListString}
    
    Analise. Se encontrar uma correspondência clara, retorne: { "found": true, "correct_name": "NOME_EXATO_DA_LISTA" }
    Senão: { "found": false }
  `;

  try {
    const rawJson = await aiService.extractData(prompt, userMessage);
    const start = rawJson.indexOf("{");
    const end = rawJson.lastIndexOf("}");
    if (start === -1 || end === -1) return null;

    const jsonStr = rawJson.substring(start, end + 1);
    const result = JSON.parse(jsonStr);

    if (result.found && result.correct_name) {
      return result.correct_name;
    }
    return null;
  } catch (e) {
    return null;
  }
}

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

  // 1. CARREGA O HISTÓRICO RECENTE (CRUCIAL para entender "Dia 15" como resposta)
  const history = await memoryService.loadRecentHistory(waId, 4);

  const extractionPrompt = `
    Você é um Gerente de Metas. Analise a mensagem e extraia as ações em JSON.
    DATA DE HOJE: ${new Date().toISOString().split("T")[0]}
    
    HISTÓRICO RECENTE:
    ${history}

    AÇÕES POSSÍVEIS ("action_type"):
    1. "create": Criar nova meta. (Ex: "Criar meta de 100k", "Coloca como meta X").
       - Se o usuário disser "consegui juntar 10k" E "coloca como meta", é "create" com esse valor.
    2. "update_progress": Atualizar progresso em meta EXISTENTE.
    3. "delete": Excluir meta.
    4. "list": Listar metas.

    REGRAS CRÍTICAS PARA DATAS (DEADLINE):
    - O campo "deadline" DEVE ser uma data no formato ISO "YYYY-MM-DD".
    - Se o usuário disser APENAS o mês (ex: "até fevereiro", "em março"), NÃO invente o dia. Retorne "PERGUNTAR_DIA" no campo deadline.
    - Se o usuário responder um dia (ex: "dia 15", "no final do mês") e o histórico indicar que estamos criando uma meta, combine com o mês mencionado anteriormente ou use o mês atual/próximo lógico.
    
    JSON OBRIGATÓRIO:
    {
      "intent": "manage_goals",
      "items": [
        { "action_type": "create", "goal_name": "...", "amount": "10000", "deadline": "2026-02-28" }
      ]
    }
  `;

  try {
    // 2. EXTRAÇÃO
    const rawJsonString = await aiService.extractData(
      extractionPrompt,
      fullMessage
    );
    const jsonString = cleanJsonOutput(rawJsonString);
    const data: GoalsIntention = JSON.parse(jsonString);

    console.log("🎯 [GOALS DEBUG]", JSON.stringify(data, null, 2));

    let resultsMessages: string[] = [];
    let isFinancialProgress = false;

    // 3. NORMALIZAÇÃO DE ITENS
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

    // Filtra duplicidades (Create + Update no mesmo lote)
    const createdNames = itemsToProcess
      .filter((i) => i.action_type === "create" && i.goal_name)
      .map((i) => i.goal_name?.toLowerCase());

    itemsToProcess = itemsToProcess.filter((item) => {
      if (
        item.action_type === "update_progress" &&
        item.goal_name &&
        createdNames.includes(item.goal_name.toLowerCase())
      ) {
        return false;
      }
      return true;
    });

    // 4. PROCESSAMENTO
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
          await goalsService.deleteGoalByName(waId, item.goal_name);
          resultsMessages.push(`🗑️ Meta '${item.goal_name}' excluída.`);
        }

        // C. ATUALIZAR PROGRESSO
        else if (
          item.action_type === "update_progress" &&
          item.goal_name &&
          item.amount
        ) {
          let goalNameToUse = item.goal_name;
          let updated = null;

          try {
            updated = await goalsService.updateGoalProgress(
              waId,
              goalNameToUse,
              item.amount,
              item.description
            );
          } catch (firstError: any) {
            if (firstError.message.includes("não encontrada")) {
              console.log(
                `⚠️ Meta '${goalNameToUse}' não achada. Buscando match...`
              );
              const allGoals = await goalsService.listGoals(waId);
              const matchedName = await findBestGoalMatch(
                fullMessage,
                goalNameToUse,
                allGoals
              );

              if (matchedName) {
                updated = await goalsService.updateGoalProgress(
                  waId,
                  matchedName,
                  item.amount,
                  item.description
                );
              } else {
                resultsMessages.push(
                  `❓ Não encontrei a meta "${item.goal_name}". Quer criar ela agora?`
                );
                continue;
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
        else if (item.action_type === "create" && item.goal_name) {
          const finalTarget = item.target_amount || item.amount;

          // --- LÓGICA DE PERGUNTA DE DATA ---
          if (item.deadline === "PERGUNTAR_DIA") {
            resultsMessages.push(
              `📅 Entendi o mês, mas para eu agendar certinho, preciso saber: até *qual dia* exatamente?`
            );
            // Interrompe este item para esperar a resposta do usuário
            continue;
          }

          // Validação de formato para não quebrar o banco
          let finalDeadline = item.deadline;
          if (finalDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(finalDeadline)) {
            console.warn(`⚠️ Data inválida ignorada: ${finalDeadline}`);
            finalDeadline = undefined;
          }

          if (!finalTarget) {
            resultsMessages.push(
              `⚠️ Preciso de um valor alvo para criar a meta '${item.goal_name}'.`
            );
          } else {
            const newGoal = await goalsService.createGoal(waId, {
              goal_name: item.goal_name,
              target_amount: finalTarget,
              metric_unit: item.metric_unit || "Unid",
              category: item.category || "Geral",
              deadline: finalDeadline,
            });

            // CORREÇÃO DO ERRO DE .split (Trata Date Object corretamente)
            let deadlineText = "";
            if (newGoal.deadline) {
              try {
                // O driver pg retorna Date object, usamos toLocaleDateString
                const d = new Date(newGoal.deadline);
                if (!isNaN(d.getTime())) {
                  deadlineText = ` (até ${d.toLocaleDateString("pt-BR")})`;
                }
              } catch (e) {
                console.error("Erro formatando data:", e);
              }
            }

            resultsMessages.push(
              `🌟 Meta '${newGoal.goal_name}' criada! Alvo: ${newGoal.target_amount}${deadlineText}.`
            );
          }
        }
      } catch (innerError: any) {
        console.error(`Erro item ${item.goal_name}:`, innerError);
        resultsMessages.push(
          `❌ Erro em '${item.goal_name || "item"}': ${innerError.message}`
        );
      }
    }

    if (resultsMessages.length === 0) return "";

    const combinedMessage = resultsMessages.join("\n\n");
    let systemInstruction = `Responda com personalidade: "${combinedMessage}"`;

    if (isFinancialProgress) {
      systemInstruction += `\n*PERGUNTE:* "Quer lançar esses valores no financeiro também?"`;
    }

    return await aiService.generatePersonaResponse(
      systemInstruction,
      fullMessage,
      userConfig
    );
  } catch (error: any) {
    console.error(`❌ [GOALS ERROR]:`, error);
    return `Erro nas metas: ${error.message}`;
  }
}
