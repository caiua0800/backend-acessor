// src/services/marketListService.ts
import { pool } from "../db";

const getUserId = async (whatsappId: string) => {
  const res = await pool.query("SELECT id FROM users WHERE phone_number = $1", [
    whatsappId,
  ]);
  if (res.rows.length === 0) throw new Error("Usuário não encontrado.");
  return res.rows[0].id;
};

// Adiciona item único (interno)
const addSingleItem = async (
  client: any,
  userId: string,
  itemName: string,
  quantity: number = 1
) => {
  const normalizedItemName = itemName.trim().toLowerCase();

  // LOG DB
  console.log(
    `🛒 [DB INSERT] User: ${userId} | Item: ${normalizedItemName} | Qty: ${quantity}`
  );

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

export const updateItemQuantity = async (
  whatsappId: string,
  itemId: string,
  newQuantity: number
) => {
  const userId = await getUserId(whatsappId);

  if (newQuantity <= 0) {
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
    message: "Item removido.",
    deleted_count: res.rowCount ?? 0,
  };
};

export const removeItemByName = async (
  whatsappId: string,
  itemName: string
) => {
  const userId = await getUserId(whatsappId);
  const normalizedItemName = itemName.trim().toLowerCase();

  const res = await pool.query(
    "DELETE FROM market_list_items WHERE user_id = $1 AND item_name ILIKE $2",
    [userId, `%${normalizedItemName}%`]
  );

  return {
    message: "Item removido.",
    deleted_count: res.rowCount ?? 0,
  };
};

export const clearList = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "DELETE FROM market_list_items WHERE user_id = $1 RETURNING id",
    [userId]
  );
  return {
    message: "Lista limpa.",
    deleted_count: res.rowCount ?? 0,
  };
};

export const getList = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  const res = await pool.query(
    "SELECT id, item_name, quantity, checked FROM market_list_items WHERE user_id = $1 ORDER BY created_at ASC",
    [userId]
  );
  return res.rows;
};

// Função Principal de Adição
export const addMultipleItemsToList = async (
  whatsappId: string,
  items: { itemName: string; quantity: number }[]
) => {
  const userId = await getUserId(whatsappId);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // LOG DE INÍCIO
    console.log(
      `🛒 [SERVICE] Iniciando adição de ${items.length} itens para ${whatsappId}`
    );

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
    return results;
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("🛒 [SERVICE ERROR] Rollback executado:", e);
    throw e;
  } finally {
    client.release();
  }
};
