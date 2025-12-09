import { Request, Response } from "express";
import * as vaultService from "../services/vaultService";
import { AuthRequest } from "../middlewares/authMiddleware";

// POST /vault
export const saveAnnotation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { title, category, content } = req.body;

    if (!title || !content) {
      return res
        .status(400)
        .json({ error: "Título e conteúdo são obrigatórios." });
    }

    const result = await vaultService.saveAnnotationByUserId(userId, {
      title,
      category: category || "outros",
      content,
    });
    res.status(result.action === "created" ? 201 : 200).json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /vault?query= (Buscar)
export const searchAnnotations = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const query = req.query.query as string;

    if (!query) {
      // Se a query for vazia, lista tudo resumido
      const list = await vaultService.listAllAnnotationsByUserId(userId);
      return res.json({ message: "Lista resumida.", items: list });
    }

    const items = await vaultService.searchAnnotationsByUserId(userId, query);
    res.json({ message: `Encontrado(s) ${items.length} item(s).`, items });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// DELETE /vault/:annotationId
export const deleteAnnotation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const annotationId = req.params.annotationId;

    const deleted = await vaultService.deleteAnnotationById(
      userId,
      annotationId
    );

    if (!deleted) {
      return res.status(404).json({ error: "Registro não encontrado." });
    }

    res.json({ message: "Registro deletado com sucesso." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
