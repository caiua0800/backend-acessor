import { Request, Response } from "express";
import * as todoService from "../services/todoService";
import { AuthRequest } from "../middlewares/authMiddleware";

// GET /todo
export const getTodos = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    // Opcional: query params para mostrar completas (?completed=true)
    const showCompleted = req.query.completed === "true";

    const tasks = await todoService.listTasksByUserId(userId, showCompleted);
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// POST /todo
export const createTodo = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { task, deadline } = req.body;

    if (!task)
      return res
        .status(400)
        .json({ error: "O texto da tarefa é obrigatório." });

    const newTask = await todoService.createTaskByUserId(
      userId,
      task,
      deadline
    );
    res.status(201).json(newTask);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// PATCH /todo/:id (Para marcar como feito/não feito)
export const toggleTodo = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const taskId = parseInt(req.params.id);
    const { done } = req.body; // true ou false

    if (typeof done !== "boolean") {
      return res
        .status(400)
        .json({ error: "O campo 'done' deve ser booleano." });
    }

    const updated = await todoService.updateTaskStatusByUserId(
      userId,
      taskId,
      done
    );

    if (!updated)
      return res.status(404).json({ error: "Tarefa não encontrada." });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// DELETE /todo/:id
export const deleteTodo = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const taskId = parseInt(req.params.id);

    const deleted = await todoService.deleteTaskByUserId(userId, taskId);

    if (!deleted)
      return res.status(404).json({ error: "Tarefa não encontrada." });

    res.json({ message: "Tarefa deletada.", task: deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
