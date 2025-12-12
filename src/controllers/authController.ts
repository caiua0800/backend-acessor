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
  // Função auxiliar para gerar o HTML bonito
  const getHtml = (isSuccess: boolean, message: string) => {
    const color = isSuccess ? '#10b981' : '#ef4444'; // Verde ou Vermelho
    const icon = isSuccess 
      ? `<svg viewBox="0 0 24 24" class="icon"><path fill="none" stroke="currentColor" stroke-width="2" d="M20 6L9 17l-5-5"/></svg>` // Check
      : `<svg viewBox="0 0 24 24" class="icon"><path fill="none" stroke="currentColor" stroke-width="2" d="M18 6L6 18M6 6l12 12"/></svg>`; // X

    return `
      <!DOCTYPE html>
      <html lang="pt-br">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${isSuccess ? 'Sucesso' : 'Erro'}</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background-color: #f3f4f6;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          }
          .card {
            background: white;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
            text-align: center;
            max-width: 400px;
            width: 90%;
            animation: fadeIn 0.5s ease-out forwards;
          }
          .icon-container {
            width: 80px;
            height: 80px;
            background-color: ${isSuccess ? '#d1fae5' : '#fee2e2'};
            color: ${color};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            animation: popIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards;
          }
          .icon {
            width: 40px;
            height: 40px;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          h1 {
            color: #111827;
            font-size: 24px;
            font-weight: 700;
            margin: 0 0 12px;
          }
          p {
            color: #6b7280;
            font-size: 16px;
            line-height: 1.5;
            margin: 0 0 24px;
          }
          .btn {
            background-color: ${color};
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
            text-decoration: none;
            display: inline-block;
          }
          .btn:hover {
            opacity: 0.9;
          }
          /* Animações */
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes popIn {
            from { transform: scale(0); }
            to { transform: scale(1); }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-container">
            ${icon}
          </div>
          <h1>${isSuccess ? 'Tudo pronto!' : 'Ops, algo deu errado'}</h1>
          <p>${message}</p>
          <button class="btn" onclick="window.close()">Fechar Janela</button>
        </div>
        <script>
          // Tenta fechar automaticamente após 3 segundos (funciona em popups)
          ${isSuccess ? 'setTimeout(() => { window.close(); }, 3000);' : ''}
        </script>
      </body>
      </html>
    `;
  };

  try {
    const code = req.query.code as string;
    const waId = req.query.state as string;

    if (!code || !waId) {
       throw new Error("Parâmetros inválidos ou ausentes.");
    }

    await handleCallback(code, waId);

    // Resposta de Sucesso
    res.send(getHtml(true, "Integração realizada com sucesso.<br>Esta janela deve fechar automaticamente em instantes."));

  } catch (e: any) {
    console.error(e);
    // Resposta de Erro
    // Nota: enviando status 200 para mostrar o HTML bonito, se quiser erro HTTP real use res.status(500)
    res.status(500).send(getHtml(false, `Ocorreu um erro ao processar: ${e.message || 'Erro desconhecido'}`));
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