import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import { 
  add, 
  list, 
  search, 
  update, 
  remove 
} from "../controllers/investmentController";

const router = Router();

router.use(authenticateToken);

// Rotas Gerais
router.post("/", add);          // Criar
router.get("/", list);          // Listar Resumo (Carteira)
router.get("/search", search);  // Listar Detalhado (Paginado)

// Rotas com ID
router.put("/:id", update);     // Editar
router.delete("/:id", remove);  // Deletar

export default router;