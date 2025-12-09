import { Request, Response } from "express";
import { getAuthUrl, handleCallback } from "../services/googleService";
import { loginUser, refreshSession, logoutUser } from "../services/authService";

const getIp = (req: Request) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0];
  return req.ip || "unknown";
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const ip = getIp(req);
    const userAgent = req.headers["user-agent"] || "unknown";

    if (!email || !password) {
      return res.status(400).json({ error: "E-mail e senha são obrigatórios." });
    }

    const result = await loginUser(email, password, ip, userAgent);
    res.json(result);
  } catch (e: any) {
    res.status(401).json({ error: e.message });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    const ip = getIp(req);

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token obrigatório." });
    }

    const tokens = await refreshSession(refreshToken, ip);
    res.json(tokens);
  } catch (e: any) {
    res.status(403).json({ error: e.message });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await logoutUser(refreshToken);
    }
    res.json({ message: "Desconectado com sucesso." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

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
