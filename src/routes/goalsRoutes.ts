import { Router } from "express";
import * as controller from "../controllers/goalsController";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = Router();

// Protege todas as rotas
router.use(authenticateToken);

// 1. CRIAR: POST /goals
router.post("/", controller.create);

// 2. LISTAR: GET /goals
router.get("/", controller.list);

// 3. ATUALIZAR PROGRESSO: PATCH /goals/progress/:goalId
// Usamos PATCH para atualizar uma "parte" do recurso (o progresso)
router.patch("/progress/:goalId", controller.updateProgress);

// 4. ATUALIZAR DETALHES: PUT /goals/:goalId
// Usamos PUT para substituir ou atualizar o recurso inteiro (detalhes da meta)
router.put("/:goalId", controller.updateDetails);

// 5. DELETAR: DELETE /goals/:goalId
router.delete("/:goalId", controller.remove);

export default router;
