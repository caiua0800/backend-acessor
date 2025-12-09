import { Router } from "express";
import * as controller from "../controllers/marketListController";
import { authenticateToken } from "../middlewares/authMiddleware";

const router = Router();

// Aplica autenticação a todas as rotas
router.use(authenticateToken);

// 1. LISTAR TUDO (GET /market-list)
router.get("/", controller.get);

// 2. ADICIONAR ITEM(S) (POST /market-list)
router.post("/", controller.add);

// 3. ATUALIZAR QUANTIDADE (PUT /market-list/:itemId)
router.put("/:itemId", controller.update);

// 4. REMOVER UM ITEM (DELETE /market-list/:itemId)
router.delete("/:itemId", controller.remove);

// 5. APAGAR TUDO (DELETE /market-list/clear)
router.delete("/clear", controller.clear);

export default router;
