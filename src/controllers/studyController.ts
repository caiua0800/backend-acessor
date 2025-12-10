// src/controllers/studyController.ts

import { Request, Response } from "express";
import { AuthRequest } from "../middlewares/authMiddleware";
import * as studyService from "../services/studyService";
import { GeneratedPlan } from "../services/types";

// =================================================================
// ROTAS DE MATÉRIAS (SUBJECTS)
// =================================================================

// POST /study/subjects
export const createSubject = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { name, category } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ error: "O nome da matéria é obrigatório." });
    }

    // Assumindo a função createSubjectByUserId no serviço
    const newSubject = await (studyService as any).createSubjectByUserId(
      userId,
      name,
      category
    );

    res.status(201).json({
      message: "Matéria cadastrada com sucesso.",
      subject: newSubject,
    });
  } catch (e: any) {
    // Trata erro de unicidade (nome de matéria duplicado)
    if (e.message.includes("já existe")) {
      return res.status(409).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
};

// GET /study/subjects
export const listSubjects = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    // Assumindo a função listSubjectsByUserId no serviço
    const subjects = await (studyService as any).listSubjectsByUserId(userId);
    res.json(subjects);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// DELETE /study/subjects/:subjectId
export const deleteSubject = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { subjectId } = req.params;

    // Assumindo a função deleteSubjectByUserId no serviço
    const deleted = await (studyService as any).deleteSubjectByUserId(
      userId,
      subjectId
    );

    if (!deleted) {
      return res.status(404).json({ error: "Matéria não encontrada." });
    }

    res.json({ message: "Matéria removida com sucesso." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// =================================================================
// ROTAS DE PLANOS (PLANS)
// =================================================================

// GET /study/plans/latest (Obter plano em rascunho ou ativo)
export const getLatestPlan = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    // Assumindo a função getLatestPlanByUserId no serviço
    const plan = await (studyService as any).getLatestPlanByUserId(userId);

    if (!plan) {
      return res
        .status(404)
        .json({ message: "Nenhum plano ativo ou em rascunho encontrado." });
    }

    res.json(plan);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// POST /study/plans/draft (Inicia um novo rascunho de plano)
export const createDraftPlan = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { subjectId, contentToStudy } = req.body;

    if (!subjectId || !contentToStudy) {
      return res
        .status(400)
        .json({ error: "subjectId e contentToStudy são obrigatórios." });
    }

    // Assumindo a função createDraftPlanByUserId no serviço
    const newDraft = await (studyService as any).createDraftPlanByUserId(
      userId,
      subjectId,
      contentToStudy
    );

    res.status(201).json({
      message:
        "Rascunho de plano criado. Pronto para gerar o plano estruturado.",
      plan: newDraft,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// PATCH /study/plans/:planId/generate (Gera e ativa o plano com os passos da IA)
export const generateAndActivatePlan = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.userId!;
    const { planId } = req.params;
    const { generatedPlan } = req.body; // Deve ser a estrutura JSONB: { "plan_steps": [...] }

    if (!generatedPlan || !generatedPlan.plan_steps) {
      return res.status(400).json({
        error: "A estrutura 'generatedPlan' com 'plan_steps' é obrigatória.",
      });
    }

    // Assumindo a função updatePlanWithGeneratedPlanByUserId no serviço
    const activatedPlan = await (
      studyService as any
    ).updatePlanWithGeneratedPlanByUserId(
      userId,
      planId,
      generatedPlan as GeneratedPlan
    );

    res.json({
      message: "Plano estruturado gerado e ativado com sucesso.",
      plan: activatedPlan,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// PATCH /study/plans/:planId/advance (Avançar para o próximo passo)
export const advancePlan = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { planId } = req.params;

    // Assumindo a função advancePlanStepByUserId no serviço
    const advancedPlan = await (studyService as any).advancePlanStepByUserId(
      userId,
      planId
    );

    res.json({
      message: "Progresso do plano atualizado para o próximo passo.",
      plan: advancedPlan,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// PATCH /study/plans/:planId/complete (Marcar como concluído/arquivado)
export const completePlan = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { planId } = req.params;

    // Assumindo a função completePlanByUserId no serviço
    const completed = await (studyService as any).completePlanByUserId(
      userId,
      planId
    );

    if (!completed) {
      return res
        .status(404)
        .json({ error: "Plano não encontrado ou já concluído." });
    }

    res.json({
      message: "Plano de estudo marcado como concluído e arquivado.",
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
