// src/services/marketListService.ts
import { pool } from "../db";

// Helper interno para o BOT
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

// ============================================================================
// 🤖 FUNÇÕES PARA O BOT (VIA WHATSAPP ID) - MANTIDAS
// ============================================================================

export const updateItemQuantity = async (
  whatsappId: string,
  itemId: string,
  newQuantity: number
) => {
  const userId = await getUserId(whatsappId);
  return updateItemQuantityByUserId(userId, itemId, newQuantity);
};

export const removeItemFromList = async (
  whatsappId: string,
  itemId: string
) => {
  const userId = await getUserId(whatsappId);
  return removeItemFromListByUserId(userId, itemId);
};

export const clearList = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  return clearListByUserId(userId);
};

export const getList = async (whatsappId: string) => {
  const userId = await getUserId(whatsappId);
  return getListByUserId(userId);
};

export const addMultipleItemsToList = async (
  whatsappId: string,
  items: { itemName: string; quantity: number }[]
) => {
  const userId = await getUserId(whatsappId);
  return addMultipleItemsToListByUserId(userId, items);
};

// ============================================================================
// 📱 FUNÇÕES PARA A API / CONTROLLER (VIA USER ID / TOKEN)
// ============================================================================

export const updateItemQuantityByUserId = async (
  userId: string,
  itemId: string,
  newQuantity: number
) => {
  if (newQuantity <= 0) {
    return removeItemFromListByUserId(userId, itemId);
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

export const removeItemFromListByUserId = async (
  userId: string,
  itemId: string
) => {
  const res = await pool.query(
    "DELETE FROM market_list_items WHERE id = $1 AND user_id = $2",
    [itemId, userId]
  );
  return {
    message: "Item removido.",
    deleted_count: res.rowCount ?? 0,
  };
};

export const clearListByUserId = async (userId: string) => {
  const res = await pool.query(
    "DELETE FROM market_list_items WHERE user_id = $1 RETURNING id",
    [userId]
  );
  return {
    message: "Lista limpa.",
    deleted_count: res.rowCount ?? 0,
  };
};

export const getListByUserId = async (userId: string) => {
  const res = await pool.query(
    "SELECT id, item_name, quantity, checked FROM market_list_items WHERE user_id = $1 ORDER BY created_at ASC",
    [userId]
  );
  return res.rows;
};

export const addMultipleItemsToListByUserId = async (
  userId: string,
  items: { itemName: string; quantity: number }[]
) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    console.log(
      `🛒 [SERVICE] Iniciando adição de ${items.length} itens para o User ID: ${userId}`
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

// Funções que o bot usa e que não precisam ser duplicadas na API
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
