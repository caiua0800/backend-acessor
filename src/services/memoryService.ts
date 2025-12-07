// src/services/memoryService.ts

import { pool } from "../db";

// Define a estrutura da mensagem que será armazenada
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// O tipo de dado que a coluna 'history' do banco vai armazenar
type ConversationHistory = ChatMessage[];

const MAX_MESSAGES = 10; // Limite de 10 mensagens (5 trocas) para o contexto

// Função para garantir que a tabela exista (idealmente rodar na inicialização do server)
export const setupMemoryTable = async () => {
  try {
    await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_histories (
                wa_id VARCHAR(255) PRIMARY KEY,
                history JSONB NOT NULL DEFAULT '[]'::jsonb,
                updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
            );
        `);
    console.log("💾 Tabela 'chat_histories' verificada/criada com sucesso.");
  } catch (e) {
    console.error("❌ Erro ao criar a tabela de histórico de chat:", e);
  }
};

/**
 * Carrega o histórico de conversa de um usuário.
 * @param waId O ID do WhatsApp do usuário.
 * @returns Uma string formatada para o System Prompt do LLM.
 */
export async function loadHistory(waId: string): Promise<string> {
  const res = await pool.query(
    "SELECT history FROM chat_histories WHERE wa_id = $1",
    [waId]
  );

  if (res.rows.length === 0) {
    return ""; // Sem histórico
  }

  const history: ConversationHistory = res.rows[0].history;

  // Formata o histórico para ser injetado no System Prompt
  return history
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n");
}

/**
 * Salva a troca de mensagens no histórico.
 * @param waId O ID do WhatsApp do usuário.
 * @param userMessage A mensagem que o usuário enviou.
 * @param assistantMessage A mensagem que o assistente respondeu.
 */
export async function saveToHistory(
  waId: string,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Busca o histórico atual
    const res = await client.query(
      "SELECT history FROM chat_histories WHERE wa_id = $1 FOR UPDATE", // LOCKS THE ROW
      [waId]
    );

    let history: ConversationHistory =
      res.rows.length > 0 ? res.rows[0].history : [];

    // 2. Adiciona as novas mensagens
    history.push({ role: "user", content: userMessage });
    history.push({ role: "assistant", content: assistantMessage });

    // 3. Mantém apenas as últimas N mensagens
    if (history.length > MAX_MESSAGES) {
      history = history.slice(history.length - MAX_MESSAGES);
    }

    // 4. Salva (INSERT ou UPDATE)
    await client.query(
      `INSERT INTO chat_histories (wa_id, history, updated_at) 
             VALUES ($1, $2, NOW())
             ON CONFLICT (wa_id) 
             DO UPDATE SET 
                history = $2, 
                updated_at = NOW()`,
      [waId, JSON.stringify(history)]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao salvar histórico de chat:", e);
  } finally {
    client.release();
  }
}
