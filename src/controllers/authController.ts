import { Request, Response } from "express";
import {
  getAuthUrl,
  handleCallback,
  getGoogleAuthUrlRegistration, // Função para URL de cadastro
  handleGoogleCallbackForRegistration,
  verifyGoogleIdToken, // Função para trocar code por token de cadastro
} from "../services/googleService";
import { loginUser, refreshSession, logoutUser, loginUserWithGoogle } from "../services/authService";
import { v4 as uuidv4 } from "uuid";

const getIp = (req: Request) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0];
  return req.ip || "unknown";
};

// ==========================================================
// 1. ROTAS DE AUTENTICAÇÃO PADRÃO (JWT)
// ==========================================================

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

// ==========================================================
// 2. INTEGRAÇÃO GOOGLE (PÓS-LOGIN, VIA WA_ID)
// ==========================================================

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
// 3. INTEGRAÇÃO GOOGLE (PRÉ-CADASTRO, DEVOLVE TOKEN)
// ==========================================================

export const connectGoogleForRegistration = (req: Request, res: Response) => {
  try {
    // Usamos um UUID como "state"
    const state = uuidv4();
    const url = getGoogleAuthUrlRegistration(state); // Chama a função específica de cadastro
    res.json({ url, state });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const googleCallbackForRegistration = async (
  req: Request,
  res: Response
) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) throw new Error("Código de autorização faltando.");

    // Troca o 'code' pelo 'refresh_token' (USANDO A FUNÇÃO CORRETA)
    const { refreshToken } = await handleGoogleCallbackForRegistration(code);

    // HTML com script para postMessage e fechar a aba
    const htmlResponse = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Sucesso de Integração</title>
                <style>body{font-family:Arial;text-align:center;padding:50px;}</style>
            </head>
            <body>
                <h1>Integração Concluída!</h1>
                <p>O token foi processado. Fechando esta janela...</p>
                <script>
                    const refreshToken = "${refreshToken}";
                    const windowOpener = window.opener;

                    if (windowOpener) {
                        // Envia o token para a janela pai (a página de cadastro)
                        windowOpener.postMessage({
                            type: 'GOOGLE_AUTH_SUCCESS',
                            refreshToken: refreshToken
                        }, "*"); 
                        window.close();
                    } else {
                        document.body.innerHTML += '<p><strong>SUCESSO!</strong> O token foi processado. Por favor, feche esta aba.</p>';
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


export const loginGoogle = async (req: Request, res: Response) => {
  try {
      const { idToken } = req.body;
      const ip = getIp(req);
      const userAgent = req.headers["user-agent"] || "unknown";

      if (!idToken) {
          return res.status(400).json({ error: "ID Token do Google é obrigatório." });
      }
      
      // 1. Verifica o token e obtém o email
      const email = await verifyGoogleIdToken(idToken);
      
      // 2. Faz o login pelo email
      const result = await loginUserWithGoogle(email, ip, userAgent);
      
      res.json(result);

  } catch (e: any) {
      // Se o erro for de "Usuário não encontrado", damos uma mensagem amigável
      if (e.message.includes("Usuário não encontrado")) {
          return res.status(404).json({ error: e.message });
      }
      res.status(401).json({ error: "Falha na autenticação com o Google." });
  }
};