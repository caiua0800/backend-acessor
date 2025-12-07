import { Request, Response } from "express";
import { createDoc, readDoc, appendToDoc, getAuthUrl } from "../services/googleService";

const handleAuthError = (e: any, req: Request, res: Response) => {
  if (e.message === "AUTH_REQUIRED") {
    return res.json({
      status: "auth_required",
      authUrl: getAuthUrl(req.body.wa_id),
    });
  }
  res.status(500).json({ error: e.message });
};

export const create = async (req: Request, res: Response) => {
  try {
    const { wa_id, title, content } = req.body;
    const result = await createDoc(wa_id, title, content);
    res.json(result);
  } catch (e: any) {
    handleAuthError(e, req, res);
  }
};

export const read = async (req: Request, res: Response) => {
  try {
    const { wa_id, docId } = req.body;
    const result = await readDoc(wa_id, docId);
    res.json(result);
  } catch (e: any) {
    handleAuthError(e, req, res);
  }
};

export const append = async (req: Request, res: Response) => {
  try {
    const { wa_id, docId, content } = req.body;
    const result = await appendToDoc(wa_id, docId, content);
    res.json(result);
  } catch (e: any) {
    handleAuthError(e, req, res);
  }
};
