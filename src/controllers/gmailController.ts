import { Request, Response } from "express";
import * as googleService from "../services/googleService";
import { AuthRequest } from "../middlewares/authMiddleware";
import { getAuthUrlFallback } from "./calendarController"; // Reutiliza o helper de fallback

// GET /gmail/list?query=
export const listEmails = async (req: AuthRequest, res: Response) => {
  try {
    const waId = await googleService.getWhatsappIdFromUserId(req.userId!);
    const query = (req.query.query as string) || "is:unread"; // Padrão: não lidos

    const emails = await googleService.listEmails(waId, query);
    res.json(emails);
  } catch (e: any) {
    if (e.message.includes("AUTH_REQUIRED")) {
      return res.json({
        status: "auth_required",
        authUrl: await getAuthUrlFallback(req),
      });
    }
    res.status(500).json({ error: e.message });
  }
};

// GET /gmail/read/:messageId
export const readEmail = async (req: AuthRequest, res: Response) => {
  try {
    const waId = await googleService.getWhatsappIdFromUserId(req.userId!);
    const messageId = req.params.messageId;

    const email = await googleService.readEmail(waId, messageId);
    res.json(email);
  } catch (e: any) {
    if (e.message.includes("AUTH_REQUIRED")) {
      return res.json({
        status: "auth_required",
        authUrl: await getAuthUrlFallback(req),
      });
    }
    res.status(500).json({ error: e.message });
  }
};
