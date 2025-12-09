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
}

export const createNewUser = async (data: UserData) => {
  // 1. Formata o Nome
  const finalName = data.fullName.trim().toUpperCase();
  const finalEmail = data.email.trim().toLowerCase(); // Normaliza e-mail

  // 2. Limpeza e Formatação do Telefone
  const cleanCountry = data.countryCode.toString().replace(/\D/g, "");
  const cleanArea = data.areaCode.toString().replace(/\D/g, "");
  let cleanNumber = data.rawNumber.toString().replace(/\D/g, "");

  if (cleanNumber.length === 8) {
    cleanNumber = "9" + cleanNumber;
  }
  const finalPhone = `${cleanCountry}${cleanArea}${cleanNumber}`;

  // 3. Gerar Hash da Senha (Segurança)
  const saltRounds = 12; // 12 é um custo alto e seguro para hoje em dia
  const passwordHash = await bcrypt.hash(data.password, saltRounds);

  // 4. Inicia a Transação
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 5. Cria o Usuário (Agora com e-mail e password)
    // OBS: Certifique-se que as colunas no banco se chamam 'email' e 'password'
    const userRes = await client.query(
      `INSERT INTO users (full_name, phone_number, email, password, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id`,
      [finalName, finalPhone, finalEmail, passwordHash]
    );

    const userId = userRes.rows[0].id;

    // 6. Cria as Configurações para esse Usuário
    await client.query(
      `INSERT INTO user_configs (user_id, user_nickname, agent_nickname, agent_gender, agent_voice_id, agent_personality)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        data.userNickname || null,
        data.agentNickname || "Acessor",
        data.agentGender || "Masculino",
        data.agentVoiceId || null,
        data.agentPersonality || ["Amigo", "Eficiente"],
      ]
    );

    // 7. Confirma a Transação
    await client.query("COMMIT");

    // 8. Retorna os dados (EXCETO A SENHA/HASH para não trafegar de volta)
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
