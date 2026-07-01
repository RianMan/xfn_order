import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve("data");
const dbPath = path.join(dataDir, "after_sales.db");
const legacyOrdersPath = path.join(dataDir, "orders.json");
const legacyStaffPath = path.join(dataDir, "staff.json");

let db;

function readLegacyJson(file, key) {
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf8"))?.[key] ?? [];
  } catch {
    return [];
  }
}

function orderColumns(order) {
  const receivedAt = order.receivedAt || order.appliedAt || order.createdAt || "";
  return {
    id: order.id,
    order_number: order.orderNumber,
    status: order.status ?? "pending",
    process_status: order.processStatus ?? "未处理",
    assignee_account: order.assigneeAccount ?? "",
    received_at: receivedAt,
    created_at: order.createdAt ?? new Date().toISOString(),
    updated_at: order.updatedAt ?? new Date().toISOString(),
    data_json: JSON.stringify(order)
  };
}

function migrateLegacyOrders(database) {
  const count = database.prepare("SELECT COUNT(*) AS count FROM orders").get().count;
  if (count > 0) return;

  const insert = database.prepare(`
    INSERT OR IGNORE INTO orders (
      id, order_number, status, process_status, assignee_account,
      received_at, created_at, updated_at, data_json
    ) VALUES (
      :id, :order_number, :status, :process_status, :assignee_account,
      :received_at, :created_at, :updated_at, :data_json
    )
  `);

  for (const order of readLegacyJson(legacyOrdersPath, "orders")) {
    if (!order?.id || !order?.orderNumber) continue;
    insert.run(orderColumns(order));
  }
}

function migrateLegacyStaff(database) {
  const count = database.prepare("SELECT COUNT(*) AS count FROM staff").get().count;
  if (count > 0) return;

  const insert = database.prepare(`
    INSERT OR IGNORE INTO staff (id, account, name, password, role, disabled, created_at)
    VALUES (:id, :account, :name, :password, :role, :disabled, :created_at)
  `);

  for (const staff of readLegacyJson(legacyStaffPath, "staff")) {
    if (!staff?.id || !staff?.account) continue;
    insert.run({
      id: staff.id,
      account: staff.account,
      name: staff.name ?? "",
      password: staff.password ?? "",
      role: staff.role ?? "operator",
      disabled: staff.disabled ? 1 : 0,
      created_at: staff.createdAt ?? new Date().toISOString()
    });
  }
}

function ensureStaffRoleColumn(database) {
  const columns = database.prepare("PRAGMA table_info(staff)").all().map((row) => row.name);
  if (!columns.includes("role")) {
    database.exec("ALTER TABLE staff ADD COLUMN role TEXT NOT NULL DEFAULT 'operator'");
  }
  if (!columns.includes("disabled")) {
    database.exec("ALTER TABLE staff ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
  }
}

export function getDb() {
  if (db) return db;

  mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      process_status TEXT NOT NULL DEFAULT '未处理',
      assignee_account TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_assignee ON orders(assignee_account);
    CREATE INDEX IF NOT EXISTS idx_orders_received_at ON orders(received_at);

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      account TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator',
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  ensureStaffRoleColumn(db);
  migrateLegacyOrders(db);
  migrateLegacyStaff(db);
  return db;
}

export function saveOrderRow(order) {
  const row = orderColumns(order);
  getDb().prepare(`
    INSERT INTO orders (
      id, order_number, status, process_status, assignee_account,
      received_at, created_at, updated_at, data_json
    ) VALUES (
      :id, :order_number, :status, :process_status, :assignee_account,
      :received_at, :created_at, :updated_at, :data_json
    )
    ON CONFLICT(id) DO UPDATE SET
      order_number = excluded.order_number,
      status = excluded.status,
      process_status = excluded.process_status,
      assignee_account = excluded.assignee_account,
      received_at = excluded.received_at,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `).run(row);
}

export function parseOrderRow(row) {
  return JSON.parse(row.data_json);
}
