import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import {
  saveAnnotation,
  searchAnnotations,
  deleteAnnotation,
} from "../controllers/vaultController";

const router = Router();

// Protege todas as rotas
router.use(authenticateToken);

// SALVAR / ATUALIZAR (POST /vault)
router.post("/", saveAnnotation);

// BUSCAR / LISTAR (GET /vault?query=pix)
router.get("/", searchAnnotations);

// DELETAR (DELETE /vault/:annotationId)
router.delete("/:annotationId", deleteAnnotation);

export default router;
