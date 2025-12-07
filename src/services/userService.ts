import { pool } from "../db";

// Interface para organizar os dados
interface UserData {
  fullName: string;
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

  // 2. Limpeza e Formatação do Telefone
  const cleanCountry = data.countryCode.toString().replace(/\D/g, "");
  const cleanArea = data.areaCode.toString().replace(/\D/g, "");
  let cleanNumber = data.rawNumber.toString().replace(/\D/g, "");

  if (cleanNumber.length === 8) {
    cleanNumber = "9" + cleanNumber;
  }
  const finalPhone = `${cleanCountry}${cleanArea}${cleanNumber}`;

  // 3. Inicia a Transação
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 4. Cria o Usuário e pega o ID gerado
    const userRes = await client.query(
      `INSERT INTO users (full_name, phone_number, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING id`,
      [finalName, finalPhone]
    );

    const userId = userRes.rows[0].id;

    // 5. Cria as Configurações para esse Usuário
    // Usa os valores recebidos ou os padrões do banco
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

    // 6. Confirma a Transação
    await client.query("COMMIT");

    // 7. Retorna os dados para confirmação
    // (Buscamos de novo para garantir que tudo foi salvo corretamente)
    const finalUser = await client.query(
      `SELECT u.id, u.full_name, u.phone_number, uc.* 
         FROM users u
         JOIN user_configs uc ON u.id = uc.user_id
         WHERE u.id = $1`,
      [userId]
    );

    return finalUser.rows[0];
  } catch (error) {
    // Se der qualquer erro, desfaz tudo
    await client.query("ROLLBACK");
    throw error;
  } finally {
    // Libera a conexão
    client.release();
  }
};
