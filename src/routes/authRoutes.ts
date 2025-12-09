import { Router } from "express";
import {
  connect,
  callback,
  login,
  refreshToken,
  logout,
  connectGoogleForRegistration,
  googleCallbackForRegistration,
  loginGoogle,
} from "../controllers/authController";

const router = Router();

// Rotas de Autenticação Padrão
router.post("/login", login);
router.post("/google-login", loginGoogle);
router.post("/refresh", refreshToken);
router.post("/logout", logout);

// Rotas de Integração Google Antigas (Pós-Login, via wa_id)
router.get("/connect", connect);
router.get("/callback", callback);

// === NOVO FLUXO DE CADASTRO/TOKEN TEMPORÁRIO ===
// 1. Rota que o FRONTEND chama para obter a URL do Google
router.get("/google-connect", connectGoogleForRegistration);
// 2. Rota que o GOOGLE redireciona (DEVE BATER NESTE ENDPOINT)
router.get("/google-callback-token", googleCallbackForRegistration);

export default router;
