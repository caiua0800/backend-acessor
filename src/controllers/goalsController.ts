import { Request, Response } from "express";
import * as goalService from "../services/goalsService";

// POST /goals/create
export const create = async (req: Request, res: Response) => {
  try {
    const {
      wa_id,
      goal_name,
      target_amount,
      metric_unit,
      category,
      deadline,
      details_json,
    } = req.body;

    const newGoal = await goalService.createGoal(wa_id, {
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

// POST /goals/update-progress
export const updateProgress = async (req: Request, res: Response) => {
  try {
    const { wa_id, goal_id, amount, description, source_transaction_id } =
      req.body;

    const updatedGoal = await goalService.updateGoalProgress(
      wa_id,
      goal_id,
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

// POST /goals/list
export const list = async (req: Request, res: Response) => {
  try {
    const goals = await goalService.listGoals(req.body.wa_id);
    res.json(goals);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// DELETE /goals/:goalId
export const remove = async (req: Request, res: Response) => {
  try {
    const { wa_id } = req.body;
    const { goalId } = req.params;

    const deleted = await goalService.deleteGoal(wa_id, goalId);

    if (!deleted) {
      return res.status(404).json({ message: "Meta não encontrada." });
    }

    res.json({ status: "success", message: "Meta apagada com sucesso." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// PUT /goals/:goalId
export const updateDetails = async (req: Request, res: Response) => {
  try {
    const { wa_id, ...data } = req.body;
    const { goalId } = req.params;

    const updatedGoal = await goalService.updateGoalDetails(
      wa_id,
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
