import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import {
  createUser,
  updatePhone,
  updateConfig,
  getUser,
} from "../controllers/userController";

const router = Router();

// 1. Rota de CRIAÇÃO (Sem autenticação - A única que não precisa)
router.post("/create", createUser);

// 🔒 Aplica o middleware de autenticação em todas as rotas abaixo
router.use(authenticateToken);

// 2. Rota para mudar telefone (PUT /users/phone)
router.put("/phone", updatePhone);

// 3. Rota para mudar configs do bot/user (PATCH /users/config)
router.patch("/config", updateConfig);
router.get("/me", getUser); 
export default router;
