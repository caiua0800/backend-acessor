import { Router } from "express";
import * as controller from "../controllers/ideaController";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = Router();

// 🔒 Protege todas as rotas com JWT (Obrigatório para ter req.userId)
router.use(authenticateToken);

// Criar (POST /ideas)
router.post("/", controller.create);

// Listar (GET /ideas) - Agora usa o Token para saber quem é
router.get("/", controller.list);

// Atualizar (PUT /ideas/:ideaId)
router.put("/:ideaId", controller.update);

// Deletar Tudo (DELETE /ideas/clear)
// ⚠️ Importante: Rotas específicas devem vir ANTES de rotas com parâmetros (:ideaId)
router.delete("/clear", controller.clear);

// Deletar Uma (DELETE /ideas/:ideaId)
router.delete("/:ideaId", controller.remove);

export default router;
