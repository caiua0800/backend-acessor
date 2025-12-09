import { Request, Response } from "express";
import * as gymService from "../services/gymService";
import { AuthRequest } from "../middlewares/authMiddleware";

// GET /gym/health-settings
export const getHealthProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!; // Garantido pelo middleware
    // O gymService original esperava whatsappId, vamos precisar de uma função que aceite userId direto
    // OU buscamos o whatsappId pelo userId aqui.
    // Melhor prática: Atualizar o gymService para aceitar userId também (veja o passo 4 abaixo).

    // Por enquanto, assumindo que ajustamos o service:
    const profile = await gymService.getHealthSettingsByUserId(userId);
    res.json(profile || { message: "Perfil não configurado ainda." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// POST /gym/health-settings
export const updateHealthProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const data = req.body; // { weight, height, age, goal... }

    const updated = await gymService.setHealthSettingsByUserId(userId, data);
    res.json({ message: "Perfil atualizado com sucesso.", profile: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// GET /gym/plan
export const getWeeklyPlan = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const plan = await gymService.getFullWeeklyPlanByUserId(userId);
    res.json(plan);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// POST /gym/plan/workout
export const saveWorkoutDay = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { day, focus, exercises } = req.body;

    if (!day || !exercises)
      return res.status(400).json({ error: "Dados incompletos." });

    const saved = await gymService.saveWorkoutByUserId(userId, {
      day_of_week: day,
      focus: focus,
      exercises: exercises,
    });

    res.json({ message: "Treino salvo.", workout: saved });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
