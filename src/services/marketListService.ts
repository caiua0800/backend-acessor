// src/services/marketListService.ts
import { pool } from "../db";

// Auxiliar para pegar o ID do usuário
const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0)
    throw new Error("Usuário não encontrado para a lista de compras.");
  return res.rows[0].id;
};

const addSingleItem = async (
  client: any,
  userId: string,
  itemName: string,
  quantity: number = 1
) => {
  const normalizedItemName = itemName.trim().toLowerCase();

  const res = await client.query(
    `INSERT INTO market_list_items (user_id, item_name, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, item_name) 
       DO UPDATE SET 
          quantity = market_list_items.quantity + $3,
          checked = FALSE,
          updated_at = NOW()
       RETURNING item_name, quantity`,
    [userId, normalizedItemName, quantity]
  );

  return res.rows[0];
};

// Edita a quantidade de um item específico (mantendo a função original)
export const updateItemQuantity = async (
  whatsappId: string,
  itemId: string,
  newQuantity: number
) => {
  const userId = await getUserId(whatsappId);

  // Se a nova quantidade for zero ou menos, remove o item
  if (newQuantity <= 0) {
    // Chamando a função de remoção que usa o ID
    return removeItemFromList(whatsappId, itemId);
  }

  const res = await pool.query(
    `UPDATE market_list_items 
         SET quantity = $1, updated_at = NOW() 
         WHERE id = $2 AND user_id = $3
         RETURNING *`,
    [newQuantity, itemId, userId]
  );
  return res.rows[0];
};

// Remove um item da lista pelo ID dele (mantendo a função original)
export const removeItemFromList = async (
  whatsappId: string,
  itemId: string
) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "DELETE FROM market_list_items WHERE id = $1 AND user_id = $2",
    [itemId, userId]
  );
  return {
    message: `${res.rowCount ?? 0} item(s) removido(s) com sucesso.`,
    deleted_count: res.rowCount ?? 0,
  };
};

// FUNÇÃO NOVO: Remove um item da lista pelo NOME (USADO PELO SPECIALIST)
export const removeItemByName = async (
  whatsappId: string,
  itemName: string
) => {
  const userId = await getUserId(whatsappId);
  const normalizedItemName = itemName.trim().toLowerCase();

  // Deleta os itens que correspondem ao nome
  const res = await pool.query(
    "DELETE FROM market_list_items WHERE user_id = $1 AND item_name ILIKE $2",
    [userId, `%${normalizedItemName}%`] // Usa ILIKE com wildcards para busca flexível
  );

  // Retorna a contagem de itens deletados
  return {
    message: `${res.rowCount ?? 0} item(s) removido(s) com sucesso.`,
    deleted_count: res.rowCount ?? 0,
  };
};

// Limpa a lista inteira do usuário
export const clearList = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "DELETE FROM market_list_items WHERE user_id = $1 RETURNING id",
    [userId]
  );
  return {
    message: "Lista de compras limpa.",
    deleted_count: res.rowCount ?? 0,
  };
};

// Pega a lista atual do usuário
export const getList = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "SELECT id, item_name, quantity, checked FROM market_list_items WHERE user_id = $1 ORDER BY created_at ASC",
    [userId]
  );
  return res.rows;
};

export const addMultipleItemsToList = async (
  whatsappId: string,
  items: { itemName: string; quantity: number }[]
) => {
  const userId = await getUserId(whatsappId);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const results = [];
    for (const item of items) {
      const itemResult = await addSingleItem(
        client,
        userId,
        item.itemName,
        item.quantity
      );
      results.push(itemResult);
    }

    await client.query("COMMIT");
    return results as { item_name: string; quantity: number }[];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};
