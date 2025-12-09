import { Request, Response } from "express";
import {
  getAuthUrl,         // Rota antiga (pós-login)
  handleCallback,     // Rota antiga (pós-login)
  getGoogleAuthUrl as getGoogleAuthUrlRegistration, // <--- NOVO: Renomeia para evitar conflito/erro
  handleGoogleCallbackForRegistration,              // <--- NOVO: Pega a função correta
} from "../services/googleService";
import { loginUser, refreshSession, logoutUser } from "../services/authService";
import { v4 as uuidv4 } from "uuid"; // Para a função de registro

const getIp = (req: Request) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0];
  return req.ip || "unknown";
};

// ... (Funções Login, RefreshToken, Logout, Connect, Callback mantidas iguais, pois estão corretas) ...
export const login = async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      const ip = getIp(req);
      const userAgent = req.headers["user-agent"] || "unknown";
  
      if (!email || !password) {
        return res
          .status(400)
          .json({ error: "E-mail e senha são obrigatórios." });
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
  
  // Rotas de Integração Antigas (Pós-Login, via wa_id)
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

// ==========================================================
// ROTA DE CADASTRO/TOKEN TEMPORÁRIO (FLOW NOVO)
// ==========================================================

export const connectGoogleForRegistration = (req: Request, res: Response) => {
  try {
    // Usamos um UUID como "state"
    const state = uuidv4();
    // Usa a função correta
    const url = getGoogleAuthUrlRegistration(state); 
    res.json({ url, state });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

// Rota que o GOOGLE BATE e que DEVOLVE O TOKEN para o FRONTEND
export const googleCallbackForRegistration = async (
  req: Request,
  res: Response
) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) throw new Error("Código de autorização faltando.");

    // Troca o 'code' pelo 'refresh_token'
    const { refreshToken } = await handleGoogleCallbackForRegistration(code);

    // CRÍTICO: HTML com script que envia o token para a janela pai e fecha.
    const htmlResponse = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Sucesso de Integração</title>
            </head>
            <body>
                <h1>Integração Concluída!</h1>
                <p>Salvando token de autorização e fechando...</p>
                <script>
                    const refreshToken = "${refreshToken}";
                    const windowOpener = window.opener;

                    if (windowOpener) {
                        // Envia o token para a janela que abriu (a página de cadastro)
                        windowOpener.postMessage({
                            type: 'GOOGLE_AUTH_SUCCESS',
                            refreshToken: refreshToken
                        }, "*"); // O '*' é permissivo, em produção use o domínio exato.

                        window.close();
                    } else {
                        document.body.innerHTML += '<p><strong>SUCESSO!</strong> O token foi processado. Você pode fechar esta aba e voltar para a página de cadastro.</p>';
                    }
                </script>
            </body>
            </html>
        `;

    res.status(200).send(htmlResponse);
  } catch (e: any) {
    console.error("Erro no Callback de Cadastro:", e);
    res.status(500).send(`<h1>Erro na Integração!</h1><p>${e.message}</p>`);
  }
};