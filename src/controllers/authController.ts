import { Request, Response } from "express";
import { getAuthUrl, handleCallback } from "../services/googleService";

export const connect = (req: Request, res: Response) => {
  try {
    const waId = req.query.wa_id as string;
    if (!waId) throw new Error("wa_id é obrigatório");
    const url = getAuthUrl(waId);
    res.json({ url });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const callback = async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const waId = req.query.state as string;
    if (!code || !waId) throw new Error("Parâmetros inválidos");
    await handleCallback(code, waId);
    res.send("<h1>Sucesso!</h1><p>Pode fechar e voltar para o WhatsApp.</p>");
  } catch (e: any) {
    console.error(e);
    res.status(500).send(`Erro: ${e.message}`);
  }
};
