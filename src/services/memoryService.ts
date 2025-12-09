import { pool } from "../db";

// Define a estrutura da mensagem que será armazenada
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// O tipo de dado que a coluna 'history' do banco vai armazenar
type ConversationHistory = ChatMessage[];

const MAX_MESSAGES = 15; // Histórico geral salvo no banco

// Função para garantir que a tabela exista
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
 * Carrega TODO o histórico disponível (Função Original - NÃO ALTERADA).
 */
export async function loadHistory(waId: string): Promise<string> {
  const res = await pool.query(
    "SELECT history FROM chat_histories WHERE wa_id = $1",
    [waId]
  );

  if (res.rows.length === 0) {
    return "";
  }

  const history: ConversationHistory = res.rows[0].history;

  return history
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n");
}

/**
 * NOVO: Carrega apenas as últimas N mensagens.
 * Usado para verificar contexto imediato (ex: respostas de Sim/Não).
 */
export async function loadRecentHistory(
  waId: string,
  limit: number
): Promise<string> {
  const res = await pool.query(
    "SELECT history FROM chat_histories WHERE wa_id = $1",
    [waId]
  );

  if (res.rows.length === 0) {
    return "";
  }

  let history: ConversationHistory = res.rows[0].history;

  // Fatia o array para pegar apenas os últimos 'limit' itens
  if (history.length > limit) {
    history = history.slice(history.length - limit);
  }

  return history
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n");
}

/**
 * Salva a troca de mensagens no histórico.
 */
export async function saveToHistory(
  waId: string,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const res = await client.query(
      "SELECT history FROM chat_histories WHERE wa_id = $1 FOR UPDATE",
      [waId]
    );

    let history: ConversationHistory =
      res.rows.length > 0 ? res.rows[0].history : [];

    history.push({ role: "user", content: userMessage });
    history.push({ role: "assistant", content: assistantMessage });

    if (history.length > MAX_MESSAGES) {
      history = history.slice(history.length - MAX_MESSAGES);
    }

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
