import { getDb } from "./db.js";

function rowToReplacementOrder(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    reason: row.reason,
    result: row.result,
    replacedOrder: row.replaced_order,
    handler: row.handler,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function cleanText(value) {
  return String(value ?? "").trim();
}

export async function readReplacementOrders(keyword = "") {
  const cleanKeyword = cleanText(keyword);
  if (!cleanKeyword) {
    return getDb().prepare(`
      SELECT id, order_number, reason, result, replaced_order, handler, created_at, updated_at
      FROM replacement_orders
      ORDER BY created_at DESC
    `).all().map(rowToReplacementOrder);
  }

  const like = `%${cleanKeyword}%`;
  return getDb().prepare(`
    SELECT id, order_number, reason, result, replaced_order, handler, created_at, updated_at
    FROM replacement_orders
    WHERE order_number LIKE ?
      OR reason LIKE ?
      OR result LIKE ?
      OR replaced_order LIKE ?
      OR handler LIKE ?
    ORDER BY created_at DESC
  `).all(like, like, like, like, like).map(rowToReplacementOrder);
}

export async function createReplacementOrder(payload = {}) {
  const item = {
    id: crypto.randomUUID(),
    orderNumber: cleanText(payload.orderNumber),
    reason: cleanText(payload.reason),
    result: cleanText(payload.result),
    replacedOrder: cleanText(payload.replacedOrder),
    handler: cleanText(payload.handler),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!item.orderNumber) throw new Error("订单号不能为空");
  if (!item.reason) throw new Error("原因不能为空");
  if (!item.result) throw new Error("处理结果不能为空");
  if (!item.replacedOrder) throw new Error("被替换的订单不能为空");
  if (!item.handler) throw new Error("处理人不能为空");

  getDb().prepare(`
    INSERT INTO replacement_orders (
      id, order_number, reason, result, replaced_order, handler, created_at, updated_at
    ) VALUES (
      :id, :orderNumber, :reason, :result, :replacedOrder, :handler, :createdAt, :updatedAt
    )
  `).run(item);

  return item;
}
