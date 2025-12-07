import { Request, Response } from "express";
import { listEmails, readEmail } from "../services/googleService";
import { getAuthUrl } from "../services/googleService";

export const list = async (req: Request, res: Response) => {
  try {
    const { wa_id, query } = req.body;
    const emails = await listEmails(wa_id, query);
    res.json({ emails });
  } catch (e: any) {
    if (e.message === "AUTH_REQUIRED") {
      return res.json({
        status: "auth_required",
        authUrl: getAuthUrl(req.body.wa_id),
      });
    }
    res.status(500).json({ error: e.message });
  }
};

export const read = async (req: Request, res: Response) => {
  try {
    const { wa_id, message_id } = req.body;
    const emailContent = await readEmail(wa_id, message_id);
    res.json({ email: emailContent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
