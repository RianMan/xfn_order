import { getDb } from "./db.js";

function rowToStaff(row) {
  return {
    id: row.id,
    account: row.account,
    name: row.name,
    password: row.password,
    role: row.role || "operator",
    createdAt: row.created_at
  };
}

export async function readStaff() {
  return getDb().prepare(`
    SELECT id, account, name, password, role, created_at
    FROM staff
    ORDER BY created_at DESC
  `).all().map(rowToStaff);
}

function cleanRole(value) {
  return value === "admin" ? "admin" : "operator";
}

export async function hasAdminStaff() {
  return Boolean(getDb().prepare("SELECT id FROM staff WHERE role = 'admin' LIMIT 1").get());
}

export async function createStaff({ account, name, password, role }) {
  const cleanAccount = String(account || "").trim();
  const cleanName = String(name || "").trim();
  const cleanPassword = String(password || "").trim();
  const cleanStaffRole = cleanRole(role);

  if (!cleanAccount || !cleanName || !cleanPassword) {
    throw new Error("账号、姓名、密码不能为空");
  }

  const database = getDb();
  const existed = database.prepare("SELECT id FROM staff WHERE account = ?").get(cleanAccount);
  if (existed) {
    throw new Error("员工账号已存在");
  }

  const item = {
    id: crypto.randomUUID(),
    account: cleanAccount,
    name: cleanName,
    password: cleanPassword,
    role: cleanStaffRole,
    createdAt: new Date().toISOString()
  };

  database.prepare(`
    INSERT INTO staff (id, account, name, password, role, created_at)
    VALUES (:id, :account, :name, :password, :role, :createdAt)
  `).run(item);

  return item;
}

export async function updateStaff(id, patch = {}) {
  const cleanId = String(id || "").trim();
  const cleanAccount = String(patch.account || "").trim();
  const cleanName = String(patch.name || "").trim();
  const cleanPassword = String(patch.password || "").trim();
  const cleanStaffRole = cleanRole(patch.role);

  if (!cleanId) throw new Error("员工不存在");
  if (!cleanAccount || !cleanName) {
    throw new Error("账号、姓名不能为空");
  }

  const database = getDb();
  const current = database.prepare("SELECT id, password FROM staff WHERE id = ?").get(cleanId);
  if (!current) throw new Error("员工不存在");

  const existed = database.prepare("SELECT id FROM staff WHERE account = ? AND id != ?").get(cleanAccount, cleanId);
  if (existed) throw new Error("员工账号已存在");

  database.prepare(`
    UPDATE staff
    SET account = ?, name = ?, password = ?, role = ?
    WHERE id = ?
  `).run(cleanAccount, cleanName, cleanPassword || current.password, cleanStaffRole, cleanId);

  return rowToStaff(database.prepare(`
    SELECT id, account, name, password, role, created_at
    FROM staff
    WHERE id = ?
  `).get(cleanId));
}

export async function verifyStaff(account, password) {
  const row = getDb().prepare(`
    SELECT id, account, name, password, role, created_at
    FROM staff
    WHERE account = ? AND password = ?
  `).get(String(account || "").trim(), String(password || ""));

  return row ? rowToStaff(row) : undefined;
}
