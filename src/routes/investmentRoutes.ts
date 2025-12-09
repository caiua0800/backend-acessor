import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import { add, list } from "../controllers/investmentController";

const router = Router();

// Protege todas as rotas com Login
router.use(authenticateToken);

// 1. ADICIONAR APORTE: POST /investments
router.post("/", add);

// 2. LISTAR CARTEIRA: GET /investments
// Mudamos para GET (RESTful)
router.get("/", list);

export default router;
