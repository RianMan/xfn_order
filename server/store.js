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
    recoveryAmount: "",
    afterSalesCommissionAmount: "",
    wageStatus: WAGE_PENDING,
    completedAt: "",
    paymentScreenshotUpdatedAt: "",
    difficultyLevel: 0,
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
    recoveryAmount: order.recoveryAmount ?? "",
    afterSalesCommissionAmount: order.afterSalesCommissionAmount ?? "",
    difficultyLevel: Number.isFinite(Number(order.difficultyLevel)) ? Number(order.difficultyLevel) : 0,
    wageStatus: order.wageStatus ?? WAGE_PENDING,
    completedAt: order.completedAt ?? "",
    paymentScreenshotUpdatedAt: order.paymentScreenshotUpdatedAt ?? "",
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

function dateKey(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match && !text.includes("T")) return `${match[1]}-${match[2]}-${match[3]}`;
  if (!text) return "";

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function numericAmount(value, fallback = 0) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
}

function dayRange(days = 14) {
  const result = [];
  const now = new Date();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - index);
    result.push(dateKey(date.toISOString()));
  }
  return result;
}

function emptyTrendItem(date) {
  return {
    date,
    newOrders: 0,
    claimedOrders: 0,
    paidOrders: 0,
    paymentAmount: 0
  };
}

function isPaidOrder(order) {
  return order.status === "completed" || order.processStatus === "已回款";
}

function markPaidIfNeeded(order, patch) {
  if (patch?.processStatus !== "已回款") return;
  order.status = "completed";
  order.completedAt = order.completedAt || new Date().toISOString();
  order.wageStatus = order.wageStatus || WAGE_PENDING;
  order.commissionAmount = Number.isFinite(Number(order.commissionAmount))
    ? Number(order.commissionAmount)
    : DEFAULT_COMMISSION_AMOUNT;
}

function sameStringArray(left, right) {
  const leftItems = Array.isArray(left) ? left : [];
  const rightItems = Array.isArray(right) ? right : [];
  if (leftItems.length !== rightItems.length) return false;
  return leftItems.every((item, index) => item === rightItems[index]);
}

export async function readDashboardMetrics(days = 14) {
  const orders = await readOrders();
  const dates = dayRange(days);
  const trendMap = new Map(dates.map((date) => [date, emptyTrendItem(date)]));
  const today = dates.at(-1) || dateKey(new Date().toISOString());
  const statusMap = new Map();
  const assigneeMap = new Map();

  let active = 0;
  let paid = 0;
  let pending = 0;
  let processing = 0;
  let difficult = 0;
  let unassigned = 0;
  let paymentAmount = 0;

  for (const order of orders) {
    const processStatus = order.processStatus || "未处理";
    statusMap.set(processStatus, (statusMap.get(processStatus) || 0) + 1);

    const newDate = dateKey(order.receivedAt || order.appliedAt || order.createdAt || order.syncedAt);
    if (trendMap.has(newDate)) trendMap.get(newDate).newOrders += 1;

    const claimedDate = dateKey(order.claimedAt);
    if (trendMap.has(claimedDate)) trendMap.get(claimedDate).claimedOrders += 1;

    if (isPaidOrder(order)) {
      paid += 1;
      const amount = numericAmount(order.commissionAmount, DEFAULT_COMMISSION_AMOUNT);
      paymentAmount += amount;
      const paidDate = dateKey(order.completedAt || order.updatedAt);
      if (trendMap.has(paidDate)) {
        trendMap.get(paidDate).paidOrders += 1;
        trendMap.get(paidDate).paymentAmount += amount;
      }
    } else {
      active += 1;
    }

    if (processStatus === "未处理") pending += 1;
    if (["联系中", "加好友中", "加不到拍手"].includes(processStatus)) processing += 1;
    if (Number(order.difficultyLevel || 0) > 0) difficult += 1;
    if (!order.assigneeAccount && !isPaidOrder(order)) unassigned += 1;

    const assigneeName = order.assigneeName || order.handler || "";
    if (assigneeName) {
      const item = assigneeMap.get(assigneeName) || { name: assigneeName, claimed: 0, paid: 0, active: 0 };
      item.claimed += order.claimedAt ? 1 : 0;
      item.paid += isPaidOrder(order) ? 1 : 0;
      item.active += isPaidOrder(order) ? 0 : 1;
      assigneeMap.set(assigneeName, item);
    }
  }

  const trend = dates.map((date) => trendMap.get(date));
  const todayTrend = trendMap.get(today) || emptyTrendItem(today);
  const statusDistribution = Array.from(statusMap, ([name, value]) => ({ name, value }));
  const assigneeRanking = Array.from(assigneeMap.values())
    .sort((a, b) => b.paid - a.paid || b.claimed - a.claimed || b.active - a.active)
    .slice(0, 8);

  return {
    updatedAt: new Date().toISOString(),
    summary: {
      total: orders.length,
      active,
      pending,
      processing,
      paid,
      difficult,
      unassigned,
      paymentAmount,
      todayNew: todayTrend.newOrders,
      todayPaid: todayTrend.paidOrders,
      todayPaymentAmount: todayTrend.paymentAmount
    },
    trend,
    statusDistribution,
    assigneeRanking
  };
}

export async function updateOrder(id, patch) {
  const orders = await readOrders();
  const order = orders.find((item) => item.id === id);
  if (!order) return null;
  const oldPaymentScreenshots = [...(order.paymentScreenshots || [])];

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
    "recoveryAmount",
    "afterSalesCommissionAmount",
    "difficultyLevel",
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
  if ("recoveryAmount" in patch) {
    order.recoveryAmount = Number.isFinite(Number(order.recoveryAmount)) ? Number(order.recoveryAmount) : "";
  }
  if ("afterSalesCommissionAmount" in patch) {
    order.afterSalesCommissionAmount = Number.isFinite(Number(order.afterSalesCommissionAmount)) ? Number(order.afterSalesCommissionAmount) : "";
  }
  if ("paymentScreenshots" in patch && !sameStringArray(oldPaymentScreenshots, order.paymentScreenshots)) {
    order.paymentScreenshotUpdatedAt = new Date().toISOString();
  }
  markPaidIfNeeded(order, patch);

  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);
  return order;
}

function isClaimableOrder(order) {
  if (order.status === "completed" || order.processStatus === "已回款") return false;
  return !order.assigneeAccount || order.processStatus === "无法处理";
}

export async function claimNextOrder(staff) {
  const orders = await readOrders();
  const order = orders
    .filter(isClaimableOrder)
    [0];

  if (!order) return null;

  order.assigneeAccount = staff.account;
  order.assigneeName = staff.name;
  order.handler = staff.name;
  order.claimedAt = new Date().toISOString();
  order.processStatus = order.processStatus === "无法处理" ? "未处理" : (order.processStatus || "未处理");
  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);
  return staffVisibleOrder(order);
}

export async function readClaimableOrders(status = "") {
  const orders = await readOrders();
  return orders.filter((order) => {
    const claimable = isClaimableOrder(order);
    const statusOk = !status || order.processStatus === status;
    return claimable && statusOk;
  }).map(staffVisibleOrder);
}

export async function claimOrderById(id, staff) {
  const orders = await readOrders();
  const order = orders.find((item) => item.id === id);
  if (!order || !isClaimableOrder(order)) return null;

  order.assigneeAccount = staff.account;
  order.assigneeName = staff.name;
  order.handler = staff.name;
  order.claimedAt = new Date().toISOString();
  order.processStatus = order.processStatus === "无法处理" ? "未处理" : (order.processStatus || "未处理");
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
    const visibleStatusOk = scope === "history" || order.processStatus !== "无法处理";
    return ownerOk && scopeOk && statusOk && visibleStatusOk;
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
  const oldPaymentScreenshots = [...(order.paymentScreenshots || [])];

  if (patch?.unable === true) {
    return markStaffOrderUnableByOrder(order, orders, staff);
  }

  const allowedFields = [
    "processStatus",
    "paymentScreenshots",
    "recoveryAmount",
    "afterSalesCommissionAmount"
  ];

  for (const field of allowedFields) {
    if (field in patch) order[field] = patch[field];
  }

  if ("paymentScreenshots" in patch && !sameStringArray(oldPaymentScreenshots, order.paymentScreenshots)) {
    order.paymentScreenshotUpdatedAt = new Date().toISOString();
  }
  if ("recoveryAmount" in patch) {
    order.recoveryAmount = Number.isFinite(Number(order.recoveryAmount)) ? Number(order.recoveryAmount) : "";
  }
  if ("afterSalesCommissionAmount" in patch) {
    order.afterSalesCommissionAmount = Number.isFinite(Number(order.afterSalesCommissionAmount)) ? Number(order.afterSalesCommissionAmount) : "";
  }
  markPaidIfNeeded(order, patch);
  appendStaffRemark(order, staff, patch.remarkAppend);
  order.handler = staff.name;
  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);
  return staffVisibleOrder(order);
}

async function markStaffOrderUnableByOrder(order, orders, staff) {
  order.difficultyLevel = (Number.isFinite(Number(order.difficultyLevel)) ? Number(order.difficultyLevel) : 0) + 1;
  order.processStatus = "无法处理";
  appendStaffRemark(order, staff, `无法处理，退回公共池（难度 +1，当前难度 ${order.difficultyLevel}）`);
  order.assigneeAccount = "";
  order.assigneeName = "";
  order.handler = "";
  order.claimedAt = "";
  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);
  return staffVisibleOrder(order);
}

export async function markStaffOrderUnable(id, staff) {
  const orders = await readOrders();
  const order = orders.find((item) => item.id === id && item.assigneeAccount === staff.account);
  if (!order || order.status === "completed") return null;

  return markStaffOrderUnableByOrder(order, orders, staff);
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
