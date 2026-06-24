import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve("data");
const dbPath = path.join(dataDir, "orders.json");
const MIN_RECEIVED_DATE = "2026-06-22 00:00:00";
const DEFAULT_COMMISSION_AMOUNT = 3;
const WAGE_PENDING = "工资待结";

async function ensureDb() {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(dbPath, "utf8");
  } catch {
    await writeFile(dbPath, JSON.stringify({ orders: [] }, null, 2));
  }
}

export async function readOrders() {
  await ensureDb();
  const raw = await readFile(dbPath, "utf8");
  return (JSON.parse(raw).orders ?? []).map(normalizeOrder);
}

export async function saveOrders(orders) {
  await ensureDb();
  await writeFile(dbPath, JSON.stringify({ orders }, null, 2));
}

function isAfterMinDate(order) {
  const date = order.receivedAt || order.appliedAt || "";
  return date >= MIN_RECEIVED_DATE;
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

export async function importOrders(incoming) {
  const orders = await readOrders();
  const byOrderNumber = new Map(orders.map((order) => [order.orderNumber, order]));
  let created = 0;
  let skippedDuplicate = 0;
  let skippedOld = 0;

  for (const order of incoming) {
    if (!isAfterMinDate(order)) {
      skippedOld += 1;
      continue;
    }

    if (byOrderNumber.has(order.orderNumber)) {
      skippedDuplicate += 1;
      continue;
    }

    const createdOrder = normalizeOrder({
      ...order,
      importKey: order.orderNumber,
      id: crypto.randomUUID(),
      syncedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    orders.unshift(createdOrder);
    byOrderNumber.set(createdOrder.orderNumber, createdOrder);
    created += 1;
  }

  await saveOrders(orders);
  return { created, skippedDuplicate, skippedOld, total: orders.length };
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
    .sort((a, b) => String(a.receivedAt || "").localeCompare(String(b.receivedAt || "")))[0];

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
