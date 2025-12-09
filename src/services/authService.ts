import { pool } from "../db";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

const JWT_SECRET = process.env.JWT_SECRET || "default_secret";
const ACCESS_TOKEN_EXPIRY = "15m"; // 15 minutos
const REFRESH_TOKEN_EXPIRY_DAYS = 7; // 7 dias

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    full_name: string;
    email: string;
  };
}

// Gera o JWT de acesso (Stateless)
const generateAccessToken = (userId: string) => {
  // CORREÇÃO: Mude de HZ_SECRET para JWT_SECRET
  return jwt.sign({ sub: userId }, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
};

export const loginUserWithGoogle = async (
  email: string,
  ipAddress: string,
  userAgent: string
): Promise<LoginResponse> => {
  // A. Busca o usuário pelo e-mail verificado
  const userRes = await pool.query("SELECT * FROM users WHERE email = $1", [
    email.toLowerCase().trim(),
  ]);

  if (userRes.rows.length === 0) {
    throw new Error("Usuário não encontrado. Crie sua conta primeiro.");
  }

  const user = userRes.rows[0];

  // B. Cria Tokens (Reutiliza a lógica padrão)
  const accessToken = generateAccessToken(user.id);
  const refreshToken = uuidv4();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  // C. Salva Sessão
  await pool.query(
    `INSERT INTO user_sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
    [user.id, refreshToken, ipAddress, userAgent, expiresAt]
  );

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
    },
  };
};

// 1. LOGIN: Cria sessão e tokens
export const loginUser = async (
  email: string,
  plainPass: string,
  ipAddress: string,
  userAgent: string
): Promise<LoginResponse> => {
  // A. Busca usuário
  const userRes = await pool.query("SELECT * FROM users WHERE email = $1", [
    email.toLowerCase().trim(),
  ]);

  if (userRes.rows.length === 0) throw new Error("Credenciais inválidas.");
  const user = userRes.rows[0];

  // B. Verifica Senha
  const match = await bcrypt.compare(plainPass, user.password);
  if (!match) throw new Error("Credenciais inválidas.");

  // C. Gera Tokens
  const accessToken = generateAccessToken(user.id);
  const refreshToken = uuidv4(); // Refresh token opaco (UUID) é mais seguro para armazenar no banco

  // D. Calcula expiração do Refresh Token
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  // E. Salva Sessão no Banco (IP e User Agent)
  await pool.query(
    `INSERT INTO user_sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, refreshToken, ipAddress, userAgent, expiresAt]
  );

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
    },
  };
};

// 2. REFRESH: Rotaciona o token (Token Rotation)
export const refreshSession = async (
  oldRefreshToken: string,
  ipAddress: string
) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // A. Busca a sessão válida
    const sessionRes = await client.query(
      `SELECT * FROM user_sessions 
       WHERE refresh_token = $1 AND is_valid = TRUE AND expires_at > NOW()`,
      [oldRefreshToken]
    );

    if (sessionRes.rows.length === 0) {
      // DICA DE SEGURANÇA: Se tentarem usar um token antigo, pode ser roubo.
      // Aqui você poderia invalidar TODAS as sessões desse usuário por segurança.
      throw new Error("Sessão inválida ou expirada. Faça login novamente.");
    }

    const session = sessionRes.rows[0];

    // B. Token Rotation: Invalida o token antigo
    await client.query(
      "UPDATE user_sessions SET is_valid = FALSE WHERE id = $1",
      [session.id]
    );

    // C. Cria nova sessão (Novo Refresh Token)
    const newRefreshToken = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    await client.query(
      `INSERT INTO user_sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        session.user_id,
        newRefreshToken,
        ipAddress,
        session.user_agent,
        expiresAt,
      ]
    );

    // D. Gera novo Access Token
    const newAccessToken = generateAccessToken(session.user_id);

    await client.query("COMMIT");

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// 3. LOGOUT: Revoga a sessão específica
export const logoutUser = async (refreshToken: string) => {
  await pool.query(
    "UPDATE user_sessions SET is_valid = FALSE WHERE refresh_token = $1",
    [refreshToken]
  );
};
