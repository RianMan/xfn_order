import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve("data");
const staffPath = path.join(dataDir, "staff.json");

async function ensureStaffDb() {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(staffPath, "utf8");
  } catch {
    await writeFile(staffPath, JSON.stringify({ staff: [] }, null, 2));
  }
}

export async function readStaff() {
  await ensureStaffDb();
  const raw = await readFile(staffPath, "utf8");
  return JSON.parse(raw).staff ?? [];
}

async function saveStaff(staff) {
  await ensureStaffDb();
  await writeFile(staffPath, JSON.stringify({ staff }, null, 2));
}

export async function createStaff({ account, name, password }) {
  const staff = await readStaff();
  const cleanAccount = String(account || "").trim();
  const cleanName = String(name || "").trim();
  const cleanPassword = String(password || "").trim();

  if (!cleanAccount || !cleanName || !cleanPassword) {
    throw new Error("账号、姓名、密码不能为空");
  }
  if (staff.some((item) => item.account === cleanAccount)) {
    throw new Error("员工账号已存在");
  }

  const item = {
    id: crypto.randomUUID(),
    account: cleanAccount,
    name: cleanName,
    password: cleanPassword,
    createdAt: new Date().toISOString()
  };
  staff.unshift(item);
  await saveStaff(staff);
  return item;
}

export async function verifyStaff(account, password) {
  const staff = await readStaff();
  return staff.find((item) => item.account === String(account || "").trim() && item.password === String(password || ""));
}
