import { Request, Response } from "express";
import * as goalService from "../services/goalsService";
import { AuthRequest } from "../middlewares/authMiddleware";

// POST /goals/create
export const create = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const {
      goal_name,
      target_amount,
      metric_unit,
      category,
      deadline,
      details_json,
    } = req.body;

    // Usando a nova função que aceita o ID do Token
    const newGoal = await goalService.createGoalByUserId(userId, {
      goal_name,
      target_amount,
      metric_unit,
      category,
      deadline,
      details_json,
    });

    res.status(201).json({
      status: "success",
      message: "Meta criada com sucesso!",
      goal: newGoal,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// PATCH /goals/update-progress/:goalId (Mudamos para PATCH e pegamos ID do params)
export const updateProgress = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { goalId } = req.params; // ID da meta no URL
    const { amount, description, source_transaction_id } = req.body;

    // Assumimos que o goalId é o ID do banco (não o nome, para a API ser mais exata)
    const updatedGoal = await goalService.updateGoalProgressByUserId(
      userId,
      goalId,
      amount,
      description,
      source_transaction_id
    );

    res.json({
      status: "success",
      message: "Progresso da meta atualizado com sucesso!",
      goal: updatedGoal,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /goals (Mudamos para GET e usamos o ID do Token)
export const list = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const goals = await goalService.listGoalsByUserId(userId);
    res.json(goals);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// DELETE /goals/:goalId
export const remove = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { goalId } = req.params; // ID da meta no URL

    // Chamamos a função 'deleteGoal' (que aceita ID)
    const deleted = await goalService.deleteGoal(userId, goalId);

    if (!deleted) {
      return res.status(404).json({ message: "Meta não encontrada." });
    }

    res.json({ status: "success", message: "Meta apagada com sucesso." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// PUT /goals/:goalId
export const updateDetails = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { goalId } = req.params; // ID da meta no URL
    const data = req.body;

    // Usamos a nova função que aceita o ID
    const updatedGoal = await goalService.updateGoalDetailsByUserId(
      userId,
      goalId,
      data
    );

    if (!updatedGoal) {
      return res.status(404).json({ message: "Meta não encontrada." });
    }

    res.json({
      status: "success",
      message: "Detalhes da meta atualizados!",
      goal: updatedGoal,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
