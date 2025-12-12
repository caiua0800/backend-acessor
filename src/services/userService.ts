import { pool } from "../db";
import bcrypt from "bcrypt";

interface UserData {
  fullName: string;
  email: string;
  password: string;
  countryCode: string;
  areaCode: string;
  rawNumber: string;
  userNickname?: string;
  agentNickname?: string;
  agentGender?: string;
  agentVoiceId?: string;
  agentPersonality?: string[];
  googleRefreshToken?: string;
  timezone?: string;
  language?: string;
}

// --- HELPER CRÍTICO: Formatação de Telefone (Reutilizável) ---
const formatPhoneNumber = (
  countryCode: string,
  areaCode: string,
  rawNumber: string
): string => {
  const cleanCountry = countryCode.toString().replace(/\D/g, "");
  const cleanArea = areaCode.toString().replace(/\D/g, "");
  let cleanNumber = rawNumber.toString().replace(/\D/g, "");

  // Coloca o 9º dígito se faltar
  if (cleanNumber.length === 8) {
    cleanNumber = "9" + cleanNumber;
  }
  return `${cleanCountry}${cleanArea}${cleanNumber}`;
};

export const getUserById = async (userId: string) => {
  const res = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone_number, u.created_at,
            uc.user_nickname, uc.agent_nickname, uc.agent_gender, uc.agent_personality, uc.ai_send_audio
     FROM users u
     LEFT JOIN user_configs uc ON u.id = uc.user_id
     WHERE u.id = $1`,
    [userId]
  );

  if (res.rows.length === 0) {
    throw new Error("Usuário não encontrado.");
  }

  return res.rows[0];
};

// 1. CRIAÇÃO DE NOVO USUÁRIO (MANTIDO)
export const createNewUser = async (data: UserData) => {
  const finalName = data.fullName.trim().toUpperCase();
  const finalEmail = data.email.trim().toLowerCase();
  const finalPhone = formatPhoneNumber(
    data.countryCode,
    data.areaCode,
    data.rawNumber
  );

  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(data.password, saltRounds);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 5. Cria o Usuário
    const userRes = await client.query(
      `INSERT INTO users (full_name, phone_number, email, password, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id`,
      [finalName, finalPhone, finalEmail, passwordHash]
    );

    const userId = userRes.rows[0].id;

    // 6. Cria as Configurações
    await client.query(
      `INSERT INTO user_configs 
       (user_id, user_nickname, agent_nickname, agent_gender, agent_voice_id, agent_personality, timezone, language) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, // <--- Adicionado $8 e coluna language
      [
        userId,
        data.userNickname || null,
        data.agentNickname || "Acessor",
        data.agentGender || "Masculino",
        data.agentVoiceId || null,
        data.agentPersonality || ["Amigo", "Eficiente"],
        data.timezone || "America/Sao_Paulo",
        data.language || "Português (Brasil)", // <--- Valor do $8
      ]
    );

    // 7. CRÍTICO: Insere o token do Google se ele veio
    if (data.googleRefreshToken) {
      console.log("Integrando Google Refresh Token no cadastro.");
      await client.query(
        `INSERT INTO user_integrations (user_id, google_refresh_token, google_home_connected, updated_at)
             VALUES ($1, $2, TRUE, NOW())`,
        [userId, data.googleRefreshToken]
      );
    }

    // 8. Confirma a Transação
    await client.query("COMMIT");

    // Retorna o usuário criado
    const finalUser = await client.query(
      `SELECT u.id, u.full_name, u.phone_number, u.email, uc.* FROM users u
         JOIN user_configs uc ON u.id = uc.user_id
         WHERE u.id = $1`,
      [userId]
    );

    return finalUser.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// 2. ATUALIZAR NÚMERO DE TELEFONE (NOVO)
export const updatePhoneNumber = async (
  userId: string,
  countryCode: string,
  areaCode: string,
  rawNumber: string
) => {
  const newPhone = formatPhoneNumber(countryCode, areaCode, rawNumber);

  // Verifica se o número já existe no banco antes de atualizar
  const existingUser = await pool.query(
    "SELECT id FROM users WHERE phone_number = $1 AND id != $2",
    [newPhone, userId]
  );

  if (existingUser.rows.length > 0) {
    throw new Error(
      "Este número de telefone já está sendo usado por outra conta."
    );
  }

  const res = await pool.query(
    `UPDATE users SET phone_number = $1, updated_at = NOW()
     WHERE id = $2 RETURNING id, phone_number`,
    [newPhone, userId]
  );

  return res.rows[0];
};

export const getAgentConfig = async (userId: string) => {
  const res = await pool.query(
    `SELECT agent_nickname, agent_personality, agent_voice_id, language 
     FROM user_configs 
     WHERE user_id = $1`,
    [userId]
  );

  if (res.rows.length === 0) {
    throw new Error("Configurações não encontradas.");
  }
  
  return res.rows[0];
};

// export const printUserConfig

// 3. ATUALIZAR CONFIGURAÇÕES DO USUÁRIO (NOVO)
export const updateUserConfigs = async (
  userId: string,
  data: Partial<{
    userNickname: string;
    agentNickname: string;
    agentGender: string;
    agentVoiceId: string;
    agentPersonality: string[];
    ai_send_audio: boolean;
    language: string;
    timezone: string;
  }>
) => {
  const fields = [];
  const values = [];
  let queryIndex = 1;

  if (data.language !== undefined) {
    fields.push(`language = $${queryIndex++}`);
    values.push(data.language);
  }

  if (data.timezone !== undefined) {
    fields.push(`timezone = $${queryIndex++}`);
    values.push(data.timezone);
  }
  if (data.userNickname !== undefined) {
    fields.push(`user_nickname = $${queryIndex++}`);
    values.push(data.userNickname);
  }
  if (data.agentNickname !== undefined) {
    fields.push(`agent_nickname = $${queryIndex++}`);
    values.push(data.agentNickname);
  }
  if (data.agentGender !== undefined) {
    fields.push(`agent_gender = $${queryIndex++}`);
    values.push(data.agentGender);
  }
  if (data.agentVoiceId !== undefined) {
    fields.push(`agent_voice_id = $${queryIndex++}`);
    values.push(data.agentVoiceId);
  }
  if (data.agentPersonality !== undefined) {
    fields.push(`agent_personality = $${queryIndex++}`);
    values.push(data.agentPersonality);
  }
  if (data.ai_send_audio !== undefined) {
    fields.push(`ai_send_audio = $${queryIndex++}`);
    values.push(data.ai_send_audio);
  }

  if (fields.length === 0)
    throw new Error("Nenhuma configuração para atualizar.");

  // Adiciona a atualização do timestamp e o userId no WHERE
  fields.push(`updated_at = NOW()`);
  values.push(userId);

  const res = await pool.query(
    `UPDATE user_configs SET ${fields.join(", ")} 
     WHERE user_id = $${queryIndex++} RETURNING *`,
    values
  );

  return res.rows[0];
};
