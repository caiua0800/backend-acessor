import { Request, Response } from "express";
import * as riscService from "../services/riscService";

export const handleRiscEvent = async (req: Request, res: Response) => {
  // O Google exige que respondamos rápido.
  // O token vem no corpo como uma string JWT assinada.
  const token = req.body.token;

  if (!token) {
    return res.status(400).json({ error: "Token missing" });
  }

  try {
    // Processa assincronamente (não precisa esperar acabar para responder ao Google)
    riscService.processRiscToken(token).catch((err) => {
      console.error("Erro assíncrono no RISC:", err);
    });

    // O Google espera um 202 Accepted
    return res.status(202).json({ status: "accepted" });
  } catch (error) {
    return res.status(400).json({ error: "Invalid request" });
  }
};