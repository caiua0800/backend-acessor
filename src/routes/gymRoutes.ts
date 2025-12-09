import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import {
  getHealthProfile,
  updateHealthProfile,
  getWeeklyPlan,
  saveWorkoutDay,
} from "../controllers/gymController";

const router = Router();

// Todas as rotas abaixo exigem Login (Token Bearer)
router.use(authenticateToken);

// Perfil de Saúde
router.get("/profile", getHealthProfile);
router.post("/profile", updateHealthProfile);

// Plano de Treino
router.get("/plan", getWeeklyPlan);
router.post("/plan", saveWorkoutDay);

export default router;
