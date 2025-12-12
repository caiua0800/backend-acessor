import { OAuth2Client } from "google-auth-library";
import { pool } from "../db";

// O Client ID usado na autenticação Google
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(CLIENT_ID);

// Tipos de eventos RISC que o Google envia
const RISC_EVENTS = {
  ACCOUNT_DISABLED:
    "https://schemas.openid.net/secevent/risc/event-type/account-disabled",
  CREDENTIAL_CHANGE:
    "https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required",
};

/**
 * Revoga todas as sessões de um usuário específico no banco de dados.
 */
const revokeUserSessions = async (email: string, subjectId?: string) => {
  console.log(`🛡️ [RISC] Iniciando revogação de segurança para: ${email}`);

  // 1. Tenta achar o usuário pelo e-mail
  // (O ideal seria ter salvo o 'google_sub' no banco, mas vamos usar o email do payload)
  const userRes = await pool.query("SELECT id FROM users WHERE email = $1", [
    email,
  ]);

  if (userRes.rows.length === 0) {
    console.warn(`⚠️ [RISC] Usuário ${email} não encontrado no banco local.`);
    return;
  }

  const userId = userRes.rows[0].id;

  // 2. Invalida TODAS as sessões ativas desse usuário
  await pool.query(
    "UPDATE user_sessions SET is_valid = FALSE WHERE user_id = $1",
    [userId]
  );

  // 3. (Opcional) Se você tiver token do Google salvo, pode limpar também
  await pool.query(
    "UPDATE user_integrations SET google_refresh_token = NULL WHERE user_id = $1",
    [userId]
  );

  console.log(`✅ [RISC] Sessões revogadas para o usuário ID: ${userId}`);
};

/**
 * Processa o Token de Evento de Segurança recebido do Google
 */
export const processRiscToken = async (token: string) => {
  try {
    // CORREÇÃO 1: Extrair a propriedade .certs da resposta
    const certsResponse = await client.getFederatedSignonCertsAsync();
    const certs = certsResponse.certs;

    // 1. Verifica a assinatura do token usando as chaves públicas do Google
    const ticket = await client.verifySignedJwtWithCertsAsync(
      token,
      certs,
      CLIENT_ID, // Audience deve ser seu Client ID
      ["https://accounts.google.com"] // Issuer
    );

    const payload = ticket.getPayload();
    if (!payload) throw new Error("Payload vazio no token RISC.");

    // CORREÇÃO 2: Casting para 'any' para acessar 'events' (RISC property)
    const events = (payload as any).events || {};
    const email = payload.email; // O Google costuma mandar o e-mail no payload do RISC se configurado
    const subject = payload.sub; // ID único do Google

    if (!email) {
      console.warn(
        "⚠️ [RISC] Token sem e-mail. Não é possível mapear usuário."
      );
      return;
    }

    // 3. Verifica se é um evento crítico que requer logout
    if (
      events[RISC_EVENTS.ACCOUNT_DISABLED] ||
      events[RISC_EVENTS.CREDENTIAL_CHANGE]
    ) {
      await revokeUserSessions(email, subject);
    } else {
      console.log(
        "ℹ️ [RISC] Evento recebido, mas nenhuma ação destrutiva necessária."
      );
    }
  } catch (error: any) {
    console.error("❌ [RISC ERROR] Falha ao processar evento:", error.message);
    throw new Error("Invalid RISC Token");
  }
};
