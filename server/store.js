import { getDb, parseOrderRow, saveOrderRow } from "./db.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MIN_RECEIVED_DATE = "2026-06-22 00:00:00";
const DEFAULT_COMMISSION_AMOUNT = 3;
const WAGE_PENDING = "工资待结";
const backupDir = path.resolve("data/backups");

export async function readOrders() {
  const rows = getDb().prepare("SELECT data_json FROM orders").all();
  return sortOrdersByBusinessTime(rows.map(parseOrderRow).map(normalizeOrder));
}

export async function saveOrders(orders) {
  const database = getDb();
  const existing = new Set(database.prepare("SELECT id FROM orders").all().map((row) => row.id));
  const incoming = new Set(orders.map((order) => order.id).filter(Boolean));

  database.exec("BEGIN");
  try {
    for (const order of orders) saveOrderRow(normalizeOrder(order));
    const remove = database.prepare("DELETE FROM orders WHERE id = ?");
    for (const id of existing) {
      if (!incoming.has(id)) remove.run(id);
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

function isAfterMinDate(order) {
  const date = order.receivedAt || order.appliedAt || "";
  return date >= MIN_RECEIVED_DATE;
}

function orderBusinessTime(order) {
  return String(order.receivedAt || order.appliedAt || order.createdAt || "");
}

function sortOrdersByBusinessTime(orders) {
  return [...orders].sort((a, b) => {
    const byTime = orderBusinessTime(a).localeCompare(orderBusinessTime(b));
    if (byTime) return byTime;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

function normalizeOrder(order) {
  return {
    returnReason: "",
    shipped: "",
    returnTrackingNo: "",
    returnAddress: "",
    processStatus: "未处理",
    handler: "",
    internalRemark: "",
    discussion: [],
    commissionAmount: DEFAULT_COMMISSION_AMOUNT,
    wageStatus: WAGE_PENDING,
    completedAt: "",
    paymentScreenshots: [],
    otherScreenshots: order.screenshots ?? [],
    assigneeAccount: "",
    assigneeName: "",
    claimedAt: "",
    screenshots: [],
    ...order,
    paymentScreenshots: order.paymentScreenshots ?? [],
    otherScreenshots: order.otherScreenshots ?? order.screenshots ?? [],
    discussion: Array.isArray(order.discussion) ? order.discussion : [],
    commissionAmount: Number.isFinite(Number(order.commissionAmount)) ? Number(order.commissionAmount) : DEFAULT_COMMISSION_AMOUNT,
    wageStatus: order.wageStatus ?? WAGE_PENDING,
    completedAt: order.completedAt ?? "",
    status: order.status ?? "pending"
  };
}

function staffVisibleOrder(order) {
  const { shopName, maskedShopName, ...safeOrder } = order;
  return safeOrder;
}

function addExistingKeys(map, order) {
  for (const key of [order.orderNumber, order.sourceId, order.importKey]) {
    const value = String(key || "").trim();
    if (value) map.set(value, order.id);
  }
}

async function backupOrdersBeforeImport(orders) {
  if (!orders.length) return "";

  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(backupDir, `orders-before-import-${stamp}.json`);
  await writeFile(file, JSON.stringify({
    createdAt: new Date().toISOString(),
    reason: "before third-party import",
    count: orders.length,
    orders
  }, null, 2));
  return file;
}

export async function importOrders(incoming) {
  const existingOrders = await readOrders();
  const existingKeys = new Map();
  for (const order of existingOrders) addExistingKeys(existingKeys, order);

  let created = 0;
  let skippedDuplicate = 0;
  let skippedOld = 0;
  let backupPath = "";

  for (const order of incoming) {
    if (!isAfterMinDate(order)) {
      skippedOld += 1;
      continue;
    }

    const duplicateKey = [order.orderNumber, order.sourceId, order.importKey]
      .map((item) => String(item || "").trim())
      .find((item) => item && existingKeys.has(item));
    if (duplicateKey) {
      skippedDuplicate += 1;
      continue;
    }

    if (!backupPath) backupPath = await backupOrdersBeforeImport(existingOrders);

    const createdOrder = normalizeOrder({
      ...order,
      importKey: order.orderNumber,
      id: crypto.randomUUID(),
      syncedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    saveOrderRow(createdOrder);
    addExistingKeys(existingKeys, createdOrder);
    created += 1;
  }

  const total = getDb().prepare("SELECT COUNT(*) AS count FROM orders").get().count;
  return { created, skippedDuplicate, skippedOld, total, backupPath };
}

function filterOrdersByScope(orders, scope = "active") {
  if (scope === "history") return orders.filter((order) => order.status === "completed");
  return orders.filter((order) => order.status !== "completed");
}

export async function readAdminOrders(scope = "active") {
  return filterOrdersByScope(await readOrders(), scope);
}

export async function updateOrder(id, patch) {
  const orders = await readOrders();
  const order = orders.find((item) => item.id === id);
  if (!order) return null;

  const allowedFields = [
    "returnReason",
    "shipped",
    "returnTrackingNo",
    "returnAddress",
    "processStatus",
    "handler",
    "internalRemark",
    "paymentScreenshots",
    "otherScreenshots",
    "assigneeAccount",
    "assigneeName",
    "claimedAt",
    "screenshots",
    "status",
    "commissionAmount",
    "wageStatus",
    "completedAt"
  ];

  for (const field of allowedFields) {
    if (field in patch) order[field] = patch[field];
  }
  if ("assigneeAccount" in patch) {
    const account = String(order.assigneeAccount || "").trim();
    order.assigneeAccount = account;
    if (!account) {
      order.assigneeName = "";
      order.handler = "";
      order.claimedAt = "";
    } else {
      order.assigneeName = String(order.assigneeName || "").trim();
      order.handler = order.assigneeName || String(order.handler || "").trim();
      order.claimedAt = order.claimedAt || new Date().toISOString();
    }
  }
  if ("commissionAmount" in patch) {
    order.commissionAmount = Number.isFinite(Number(order.commissionAmount)) ? Number(order.commissionAmount) : DEFAULT_COMMISSION_AMOUNT;
  }

  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);
  return order;
}

export async function claimNextOrder(staff) {
  const orders = await readOrders();
  const order = orders
    .filter((item) => item.status !== "completed" && !item.assigneeAccount && item.processStatus !== "已回款")
    [0];

  if (!order) return null;

  order.assigneeAccount = staff.account;
  order.assigneeName = staff.name;
  order.handler = staff.name;
  order.claimedAt = new Date().toISOString();
  order.processStatus = order.processStatus || "未处理";
  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);
  return staffVisibleOrder(order);
}

export async function readClaimableOrders(status = "") {
  const orders = await readOrders();
  return orders.filter((order) => {
    const claimable = order.status !== "completed" && !order.assigneeAccount && order.processStatus !== "已回款";
    const statusOk = !status || order.processStatus === status;
    return claimable && statusOk;
  }).map(staffVisibleOrder);
}

export async function claimOrderById(id, staff) {
  const orders = await readOrders();
  const order = orders.find((item) => item.id === id);
  if (!order || order.status === "completed" || order.assigneeAccount || order.processStatus === "已回款") return null;

  order.assigneeAccount = staff.account;
  order.assigneeName = staff.name;
  order.handler = staff.name;
  order.claimedAt = new Date().toISOString();
  order.processStatus = order.processStatus || "未处理";
  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);
  return staffVisibleOrder(order);
}

export async function readStaffOrders(staff, status = "", scope = "active") {
  const orders = await readOrders();
  return orders.filter((order) => {
    const ownerOk = order.assigneeAccount === staff.account;
    const scopeOk = scope === "history" ? order.status === "completed" : order.status !== "completed";
    const statusOk = !status || order.processStatus === status;
    return ownerOk && scopeOk && statusOk;
  }).map(staffVisibleOrder);
}

function beijingTimeText() {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  return formatter.format(new Date()).replace(/\//g, "-");
}

function appendStaffRemark(order, staff, text) {
  const remark = String(text ?? "").trim();
  if (!remark) return;

  const line = `${beijingTimeText()} ${staff.name}：${remark}`;
  order.internalRemark = [order.internalRemark, line].filter(Boolean).join("\n");
}

export async function updateStaffOrder(id, staff, patch) {
  const orders = await readOrders();
  const order = orders.find((item) => item.id === id && item.assigneeAccount === staff.account);
  if (!order) return null;
  if (order.status === "completed") return null;

  const allowedFields = [
    "processStatus",
    "paymentScreenshots"
  ];

  for (const field of allowedFields) {
    if (field in patch) order[field] = patch[field];
  }

  appendStaffRemark(order, staff, patch.remarkAppend);
  order.handler = staff.name;
  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);
  return staffVisibleOrder(order);
}

function createDiscussionMessage(authorType, authorName, content) {
  const text = String(content ?? "").trim();
  if (!text) return null;

  return {
    id: crypto.randomUUID(),
    authorType,
    authorName,
    content: text,
    createdAt: new Date().toISOString()
  };
}

export async function addAdminDiscussion(id, content) {
  const orders = await readOrders();
  const order = orders.find((item) => item.id === id);
  if (!order) return null;

  const message = createDiscussionMessage("admin", "后台", content);
  if (!message) return { order, empty: true };

  order.discussion = [...(order.discussion || []), message];
  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);
  return { order, message };
}

export async function addStaffDiscussion(id, staff, content) {
  const orders = await readOrders();
  const order = orders.find((item) => item.id === id && item.assigneeAccount === staff.account);
  if (!order) return null;

  const message = createDiscussionMessage("staff", staff.name, content);
  if (!message) return { order: staffVisibleOrder(order), empty: true };

  order.discussion = [...(order.discussion || []), message];
  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);
  return { order: staffVisibleOrder(order), message };
}

export async function dedupeExistingOrders() {
  const orders = await readOrders();
  const seen = new Set();
  const deduped = [];
  let removed = 0;

  for (const order of orders) {
    if (seen.has(order.orderNumber)) {
      removed += 1;
    } else {
      seen.add(order.orderNumber);
      deduped.push(normalizeOrder(order));
    }
  }

  if (removed) await saveOrders(deduped);
  return { removed, total: deduped.length };
}
