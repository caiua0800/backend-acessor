import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware";
import {
  getTodos,
  createTodo,
  toggleTodo,
  deleteTodo,
} from "../controllers/todoController";

const router = Router();

// Protege todas as rotas com JWT
router.use(authenticateToken);

router.get("/", getTodos);
router.post("/", createTodo);
router.patch("/:id", toggleTodo); // Ex: PATCH /todo/15 body: { "done": true }
router.delete("/:id", deleteTodo);

export default router;
