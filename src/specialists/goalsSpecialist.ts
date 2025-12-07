// src/specialists/goalsSpecialist.ts (CÓDIGO LIMPO E COMPLETO)
import * as goalsService from "../services/goalsService";
import * as aiService from "../services/aiService";
import { UserContext } from "../services/types";

interface GoalCreationData {
  goal_name: string;
  target_amount: string;
  metric_unit: string;
  category: string;
  deadline?: string;
  details_json?: object;
}
interface ProgressData {
  goal_name: string;
  amount: string;
  description?: string;
} // <-- NOVO

interface DeleteData {
  goal_name: string;
  delete: boolean;
}
interface ListData {
  list_all: boolean;
}

type GoalExtractionData =
  | GoalCreationData
  | ProgressData
  | DeleteData
  | ListData;

export async function goalsSpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage } = context;

  // 1. TENTA EXTRAIR PROGRESSO
  const progressExtractionPrompt = `
        Você é um Extrator de Progresso de Metas. Analise a mensagem e tente extrair uma atualização de progresso de uma meta existente.
        
        ### REGRA CRÍTICA ###
        1. O campo 'goal_name' DEVE conter APENAS a palavra-chave principal da meta (Ex: "Emagrecer").
        2. O campo 'description' DEVE ser um resumo do que o usuário fez para atingir o progresso (Ex: "Fui à academia", "Caminhei 5km").
        
        Retorne APENAS o JSON no formato: {"goal_name": "Palavra Chave Principal", "amount": "Valor do Progresso", "description": "Resumo da Ação"}.
    `;

  try {
    const progressJson = await aiService.extractData(
      progressExtractionPrompt,
      fullMessage
    );
    const progressData: ProgressData = JSON.parse(progressJson);

    if (progressData.goal_name && progressData.amount) {
      const updatedGoal = await goalsService.updateGoalProgress(
        waId,
        progressData.goal_name,
        progressData.amount,
        progressData.description // <--- PASSANDO A DESCRIÇÃO
      );

      const progressFormatted =
        updatedGoal.current_progress.toLocaleString("pt-BR");

      return `✅ Progresso de *${progressData.amount}* adicionado à meta *${updatedGoal.goal_name}*! Progresso atual: ${progressFormatted}.`;
    }
  } catch (e) {
    console.warn(
      "Falha na extração/processamento de progresso, tentando próxima intenção..."
    );
  }

  // 2. TENTA EXTRAIR OUTRAS AÇÕES (Excluir/Listar)
  const actionExtractionPrompt = `
        Você é um Extrator de Ações Secundárias. Analise a mensagem APENAS para LISTAR ou EXCLUIR metas.
        1. LISTAR: Se a intenção for apenas listar, retorne: {"list_all": true}
        2. EXCLUIR: Se a intenção for excluir, retorne: {"goal_name": "Nome da Meta", "delete": true}
        3. Se não for nenhuma das anteriores, retorne um objeto vazio: {}
    `;

  try {
    const actionJson = await aiService.extractData(
      actionExtractionPrompt,
      fullMessage
    );
    const actionData = JSON.parse(actionJson);

    if ("list_all" in actionData && actionData.list_all) {
      const goals = await goalsService.listGoals(waId);
      if (goals.length === 0)
        return "✅ Não há metas cadastradas. Bora começar uma!";
      const listText = goals
        .map(
          (g) =>
            `${g.goal_name}: ${g.current_progress}/${g.target_amount} (${g.progress_percent}%)`
        )
        .join("\n");
      return `✅ Suas metas atuais são:\n${listText}`;
    }
    if ("delete" in actionData && actionData.delete && actionData.goal_name) {
      const deleted = await goalsService.deleteGoalByName(
        waId,
        actionData.goal_name
      );
      if (deleted)
        return `✅ Meta *${actionData.goal_name}* excluída com sucesso!`;
      throw new Error(
        `Meta com nome '${actionData.goal_name}' não encontrada para exclusão.`
      );
    }
  } catch (e) {
    console.warn("Falha na extração de ações, tentando criação de meta...");
  }

  // 3. TENTA EXTRAIR CRIAÇÃO DE META (Ação Final)
  const creationExtractionPrompt = `
        Você é um Extrator de Criação de Metas. Se a mensagem for para INICIAR um novo acompanhamento, extraia os detalhes.
        Retorne APENAS o JSON no formato: {"goal_name": "Nome", "target_amount": "Valor", "metric_unit": "Ex: R$, vezes", "category": "Categoria"}.
    `;

  try {
    const jsonString = await aiService.extractData(
      creationExtractionPrompt,
      fullMessage
    );
    const goalData: GoalCreationData = JSON.parse(jsonString);

    if (!goalData.goal_name || !goalData.target_amount) return "";

    const newGoal = await goalsService.createGoal(waId, goalData);
    const amountFormatted = newGoal.target_amount.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

    return `✅ Meta *${newGoal.goal_name}* criada! Objetivo: ${amountFormatted}.`;
  } catch (error) {
    const typedError = error as any;
    console.error("Erro no Goals Specialist (Criação):", typedError);
    return `❌ Ocorreu um erro ao processar sua meta: ${typedError.message}`;
  }
}
