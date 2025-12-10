// src/specialists/studySpecialist.ts

import * as studyService from "../services/studyService";
import * as aiService from "../services/aiService";
import {
  UserContext,
  Subject,
  StudyPlan,
  GeneratedPlan,
} from "../services/types";

// --- INTERFACES DE EXTRAÇÃO ---
interface AddSubjectAction {
  action: "add_subject";
  name: string;
  category?: string;
  names?: string[]; // Para múltiplas matérias
}

interface SelectSubjectAction {
  action: "select_subject";
  name: string;
}

interface ContentDefinitionAction {
  action: "content_definition";
  content: string;
  subject_name?: string;
}

interface ListAction {
  action: "list_subjects" | "list_active_plan";
}

interface PlanDecisionAction {
  action:
    | "request_plan"
    | "request_tip"
    | "confirm_progress"
    | "complete_plan"
    | "cancel_plan";
  term?: string; // Para confirmar progresso
}

type StudyExtractionData =
  | AddSubjectAction
  | SelectSubjectAction
  | ContentDefinitionAction
  | ListAction
  | PlanDecisionAction;

// --- HELPER PARA LIMPEZA DE JSON ---
function cleanJsonOutput(rawOutput: string): string {
  const start = rawOutput.indexOf("{");
  const end = rawOutput.lastIndexOf("}");
  if (start !== -1 && end !== -1) return rawOutput.substring(start, end + 1);
  return rawOutput;
}

// --- SUB-ESPECIALISTA: Geração do Plano Estruturado (LLM) ---
async function generateStructuredPlan(
  subject: Subject,
  content: string,
  context: UserContext
): Promise<GeneratedPlan> {
  // Prompt específico para a IA atuar como planejador (forçando JSON)
  const generationPrompt = `
        Você é um Planejador de Estudos de Alto Nível. Sua tarefa é transformar a lista de conteúdo em um plano de estudo detalhado, passo a passo, em formato JSON.

        PERFIL DO USUÁRIO: ${context.userName} (${context.userConfig.full_name})
        MATÉRIA: ${subject.name} (Nível: ${subject.category || "Não definido"})
        CONTEÚDO PARA ESTUDAR: "${content}"

        REGRAS CRÍTICAS DE SAÍDA:
        1. A saída DEVE ser um único objeto JSON com a chave "plan_steps".
        2. Crie no mínimo 5 e no máximo 10 passos sequenciais e lógicos.
        3. Para cada passo, estime uma DURAÇÃO aproximada em texto (Ex: "1h", "30 min", "2 horas").
        4. O campo "task" deve ser direto e acionável.

        EXEMPLO DE JSON (OBRIGATÓRIO):
        {
            "plan_steps": [
                { "order": 1, "task": "Revisar anotações e ler o capítulo 1 sobre Limites.", "duration": "1 hora" },
                { "order": 2, "task": "Fazer os exercícios ímpares da seção 2.1.", "duration": "1h 30 min" }
            ]
        }
    `;

  const rawJson = await aiService.extractData(generationPrompt, content);
  const planData = JSON.parse(cleanJsonOutput(rawJson));

  if (!planData.plan_steps || planData.plan_steps.length === 0) {
    throw new Error(
      "A IA não conseguiu gerar um plano estruturado. Tente um conteúdo mais específico."
    );
  }

  // Garante que a estrutura está correta
  return planData as GeneratedPlan;
}

// --- FUNÇÃO PRINCIPAL ---
export async function studySpecialist(context: UserContext): Promise<string> {
  const { waId, fullMessage, userConfig } = context;

  // 1. VERIFICA O ESTADO ATUAL DO PLANO
  const activePlan = await studyService.getLatestPlanByWaId(waId);

  // 2. EXTRAÇÃO DE INTENÇÃO (Baseado no estado do plano)
  const extractionPrompt = `
        Você é um Extrator de Ações de Estudo. Analise a mensagem e o estado do plano ativo.
        ESTADO ATUAL DO PLANO: ${activePlan ? activePlan.status : "NENHUM"}

        ### REGRA DE OURO (ESTADO DRAFT) ###
        Se o estado é 'draft', as únicas ações válidas são: request_plan (plano completo), request_tip (dica) ou list_subjects (para mudar o foco).

        ### REGRA DE OURO (ESTADO ACTIVE) ###
        Se o estado é 'active', a ação principal é confirm_progress (próximo passo), complete_plan (finalizar) ou cancel_plan.
        
        ### REGRA DE OURO (ESTADO NENHUM) ###
        Se não houver plano ativo, as ações são add_subject, select_subject, ou list_subjects.

        INTENÇÕES E JSONS (RETORNE APENAS UMA):
        - add_subject: {"action": "add_subject", "name": "...", "category": "..."}
        - select_subject: {"action": "select_subject", "name": "..."}
        - content_definition: {"action": "content_definition", "content": "..."}
        - request_plan: {"action": "request_plan"}
        - request_tip: {"action": "request_tip"}
        - list_subjects: {"action": "list_subjects"}
        - confirm_progress: {"action": "confirm_progress", "term": "Conclui o passo X"}
        - complete_plan: {"action": "complete_plan"}
        - cancel_plan: {"action": "cancel_plan"}

        Retorne APENAS JSON.
    `;

  const rawJson = await aiService.extractData(extractionPrompt, fullMessage);
  const data: StudyExtractionData = JSON.parse(cleanJsonOutput(rawJson));
  console.log("📚 [STUDY DATA]", JSON.stringify(data));

  let actionConfirmedMessage = "";
  let systemInstruction = "";

  // ==========================================================
  // LÓGICA DO FLUXO (STATE MACHINE)
  // ==========================================================

  // --- FLUXO 1: SEM PLANO ATIVO (INÍCIO DE TUDO) ---
  if (!activePlan) {
    // A. ADICIONAR MATÉRIA
    if (data.action === "add_subject") {
      const names = (data as AddSubjectAction).names || [
        (data as AddSubjectAction).name,
      ];
      const added: Subject[] = [];
      for (const name of names) {
        if (name) {
          const subject = await studyService.createSubject(
            waId,
            name,
            (data as AddSubjectAction).category
          );
          added.push(subject);
        }
      }

      if (added.length > 0) {
        actionConfirmedMessage = `Matéria(s) *${added
          .map((s) => s.name)
          .join(", ")}* salva(s)! Qual delas você quer estudar agora?`;
      } else {
        actionConfirmedMessage =
          "Não entendi o nome da matéria que você quer salvar. Pode repetir?";
      }
    }

    // B. LISTAR MATÉRIAS
    else if (data.action === "list_subjects") {
      const subjects = await studyService.listSubjects(waId);
      if (subjects.length === 0) {
        actionConfirmedMessage =
          "Você não tem nenhuma matéria cadastrada ainda. Use 'Cadastra [nome da matéria]' para começar!";
      } else {
        const list = subjects
          .map((s) => `• ${s.name} (${s.category || "Geral"})`)
          .join("\n");
        actionConfirmedMessage = `Suas matérias cadastradas são:\n${list}\n\nQual delas você quer estudar?`;
      }
    }

    // C. SELECIONAR MATÉRIA
    else if (data.action === "select_subject") {
      const subject = await studyService.findSubjectByName(
        waId,
        (data as SelectSubjectAction).name
      );
      if (!subject) {
        actionConfirmedMessage = `A matéria *${
          (data as SelectSubjectAction).name
        }* não está na sua lista. Quer cadastrá-la ou escolher outra?`;
      } else {
        // Inicia a criação do plano no estado DRAFT
        actionConfirmedMessage = `Ótimo! Você escolheu *${subject.name}*. Agora, me diga *todo o conteúdo* que você precisa cobrir hoje ou nesta semana. (Ex: 'Derivadas, Limites e o Teorema de Rolle...')`;
      }
    }

    // D. Conteúdo de uma Matéria (Cria o Rascunho)
    else if (data.action === "content_definition") {
      const subjName =
        (data as ContentDefinitionAction).subject_name || fullMessage;
      const subject = await studyService.findSubjectByName(waId, subjName);

      if (!subject) {
        actionConfirmedMessage = `Não consegui identificar a matéria. Por favor, diga o nome da matéria primeiro.`;
      } else {
        await studyService.createDraftPlan(
          waId,
          subject.id!,
          (data as ContentDefinitionAction).content
        );
        actionConfirmedMessage = `Conteúdo salvo para *${subject.name}*! Temos duas opções:`;
        systemInstruction = `ADICIONE ESTE TEXTO AO FINAL:\n1. Uma *dica rápida* sobre como começar (responda 'dica').\n2. Um *plano de estudo completo e estruturado* (responda 'plano').\nQual você prefere?`;
      }
    }
  }

  // --- FLUXO 2: PLANO ATIVO (DRAFT ou ACTIVE) ---
  else {
    const subject = await studyService.getSubjectByPlanId(activePlan.id);
    const planSteps = activePlan.generated_plan.plan_steps || [];

    // ESTADO DRAFT (Decisão do plano)
    if (activePlan.status === "draft") {
      // A. SOLICITAR PLANO COMPLETO
      if (data.action === "request_plan") {
        const generatedPlan = await generateStructuredPlan(
          subject,
          activePlan.content_to_study,
          context
        );
        const updatedPlan = await studyService.updatePlanWithGeneratedPlan(
          activePlan.id,
          generatedPlan
        );
        const firstStep =
          updatedPlan.generated_plan.plan_steps[updatedPlan.current_step - 1];

        actionConfirmedMessage = `Plano de estudo para *${subject.name}* gerado!\n\nSeu *PRIMEIRO PASSO* (${updatedPlan.current_step}/${updatedPlan.generated_plan.plan_steps.length}) é:\n`;
        actionConfirmedMessage += `• ${firstStep.task} (${
          firstStep.duration || "tempo não estimado"
        })`;
        systemInstruction = `ADICIONE AO FINAL: Mantenha o tom motivacional. Diga ao usuário para responder 'concluí' ou 'pronto' quando terminar para ver o próximo passo.`;
      }

      // B. SOLICITAR DICA RÁPIDA
      else if (data.action === "request_tip") {
        actionConfirmedMessage = `Aqui vai uma dica para *${subject.name}*:\n`;
        // Deixa a IA Generalista dar a dica com o contexto do conteúdo
        systemInstruction = `SUA TAREFA: Crie uma dica de estudo de 3 linhas, amigável e motivacional, sobre como abordar o seguinte conteúdo: "${activePlan.content_to_study}". Termine perguntando se ele quer o plano completo.`;
      }

      // C. Outra ação (como Listar)
      else {
        actionConfirmedMessage = `Estamos em um rascunho de plano (*${subject.name}*). O que você quer fazer: 'plano' ou 'dica'?`;
      }
    }

    // ESTADO ACTIVE (Progresso do plano)
    else if (activePlan.status === "active") {
      // A. CONFIRMAR PROGRESSO (Avança o step)
      if (data.action === "confirm_progress") {
        const nextStepIndex = activePlan.current_step;

        if (nextStepIndex < planSteps.length) {
          const nextPlan = await studyService.advancePlanStep(activePlan.id);
          const nextStep =
            nextPlan.generated_plan.plan_steps[nextPlan.current_step - 1];

          actionConfirmedMessage = `🎉 *CONCLUÍDO!* Próximo passo (${nextPlan.current_step}/${planSteps.length}):\n`;
          actionConfirmedMessage += `• ${nextStep.task} (${
            nextStep.duration || "tempo não estimado"
          })`;
          systemInstruction = `Mantenha o tom motivacional. Se o próximo passo é o último, finalize com "Quando terminar este, o plano está completo!".`;
        } else {
          // Último passo concluído
          await studyService.completePlan(activePlan.id);
          actionConfirmedMessage = `✨ *PARABÉNS!* Você completou seu plano de estudos em *${subject.name}*!`;
          systemInstruction = `ADICIONE AO FINAL: Pergunte o que ele vai estudar em seguida.`;
        }
      }

      // B. FINALIZAR/CANCELAR
      else if (
        data.action === "complete_plan" ||
        data.action === "cancel_plan"
      ) {
        await studyService.completePlan(activePlan.id);
        actionConfirmedMessage = `Plano de estudos em *${subject.name}* finalizado e arquivado!`;
        systemInstruction = `ADICIONE AO FINAL: Pergunte se ele quer começar um novo plano ou se cadastrar uma nova matéria.`;
      }

      // C. Outra ação: Relembra onde está
      else {
        const currentStep = planSteps[activePlan.current_step - 1];
        actionConfirmedMessage = `Estamos no meio do plano (*${subject.name}*). Seu passo atual (${activePlan.current_step}/${planSteps.length}) é:\n`;
        actionConfirmedMessage += `• ${currentStep.task} (${
          currentStep.duration || "tempo não estimado"
        })`;
        systemInstruction = `ADICIONE AO FINAL: Pergunte 'Você concluiu a tarefa?'.`;
      }
    }
  }

  if (!actionConfirmedMessage) {
    return ""; // Retorna string vazia para o Orquestrador chamar o Generalist
  }

  // 3. GERAÇÃO DA RESPOSTA COM PERSONALIDADE (LLM 2)
  const finalResponse = await aiService.generatePersonaResponse(
    `Sua tarefa é transformar a mensagem de confirmação técnica em uma resposta amigável, com personalidade e formatada para o WhatsApp.
        MENSAGEM TÉCNICA: "${actionConfirmedMessage}"
        INSTRUÇÕES ADICIONAIS: ${systemInstruction}`,
    fullMessage,
    userConfig
  );

  return finalResponse;
}
