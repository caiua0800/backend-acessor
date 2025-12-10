// src/routes/studyRoutes.ts

import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import * as controller from "../controllers/studyController";

const router = Router();

// 🔒 Protege todas as rotas com JWT
router.use(authenticateToken);

// ===============================================
// ROTAS DE MATÉRIAS (SUBJECTS) /study/subjects
// ===============================================

// LISTAR MATÉRIAS: GET /study/subjects
router.get("/subjects", controller.listSubjects);

// CRIAR MATÉRIA: POST /study/subjects
router.post("/subjects", controller.createSubject);

// DELETAR MATÉRIA: DELETE /study/subjects/:subjectId
router.delete("/subjects/:subjectId", controller.deleteSubject);

// ===============================================
// ROTAS DE PLANOS (PLANS) /study/plans
// ===============================================

// OBTER PLANO ATIVO/RASCUNHO: GET /study/plans/latest
router.get("/plans/latest", controller.getLatestPlan);

// CRIAR RASCUNHO: POST /study/plans/draft
router.post("/plans/draft", controller.createDraftPlan);

// GERAR E ATIVAR PLANO (Preenche o JSON com passos da IA): PATCH /study/plans/:planId/generate
router.patch("/plans/:planId/generate", controller.generateAndActivatePlan);

// AVANÇAR PASSO: PATCH /study/plans/:planId/advance
router.patch("/plans/:planId/advance", controller.advancePlan);

// CONCLUIR PLANO: PATCH /study/plans/:planId/complete
router.patch("/plans/:planId/complete", controller.completePlan);

export default router;
