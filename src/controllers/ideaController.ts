import { Response } from "express";
import * as ideaService from "../services/ideaService";
import { AuthRequest } from "../middlewares/authMiddleware";

export const create = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { content, tags } = req.body;

    if (!content) {
      return res
        .status(400)
        .json({ error: "O conteúdo da ideia é obrigatório." });
    }

    const newIdea = await ideaService.createIdeaByUserId(userId, content, tags);
    res.status(201).json({ message: "Ideia salva!", idea: newIdea });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const list = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const ideas = await ideaService.listIdeasByUserId(userId);
    res.json(ideas);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const update = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { content, tags } = req.body;
    const { ideaId } = req.params;

    const updatedIdea = await ideaService.updateIdeaByUserId(
      userId,
      ideaId,
      content,
      tags
    );

    if (!updatedIdea) {
      return res.status(404).json({ error: "Ideia não encontrada." });
    }

    res.json({ message: "Ideia atualizada!", idea: updatedIdea });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const remove = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { ideaId } = req.params;

    const result = await ideaService.deleteIdeaByUserId(userId, ideaId);

    if (!result.deleted) {
      return res
        .status(404)
        .json({ error: "Ideia não encontrada para deletar." });
    }

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const clear = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const result = await ideaService.deleteAllIdeasByUserId(userId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
