import { Request, Response } from "express";
import * as ideaService from "../services/ideaService";

export const create = async (req: Request, res: Response) => {
  try {
    const { wa_id, content, tags } = req.body;
    const newIdea = await ideaService.createIdea(wa_id, content, tags);
    res.status(201).json({ message: "Ideia salva!", idea: newIdea });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const list = async (req: Request, res: Response) => {
  try {
    const ideas = await ideaService.listIdeas(req.body.wa_id);
    res.json(ideas);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const { wa_id, content, tags } = req.body;
    const { ideaId } = req.params;
    const updatedIdea = await ideaService.updateIdea(
      wa_id,
      ideaId,
      content,
      tags
    );
    res.json({ message: "Ideia atualizada!", idea: updatedIdea });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    const { wa_id } = req.body;
    const { ideaId } = req.params;
    const result = await ideaService.deleteIdea(wa_id, ideaId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const clear = async (req: Request, res: Response) => {
  try {
    const result = await ideaService.deleteAllIdeas(req.body.wa_id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
