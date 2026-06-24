import "./env.js";
import express from "express";
import multer from "multer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ADMIN_PASSWORD, ADMIN_USER } from "./config.js";
import { uploadBuffer } from "./cos.js";
import { fetchThirdPartyOrderPages } from "./importer.js";
import { parseAfterSalesOrders } from "./parser.js";
import {
  addAdminDiscussion,
  addStaffDiscussion,
  claimNextOrder,
  claimOrderById,
  dedupeExistingOrders,
  importOrders,
  readAdminOrders,
  readClaimableOrders,
  readOrders,
  readStaffOrders,
  updateOrder,
  updateStaffOrder
} from "./store.js";
import { createStaff, readStaff, verifyStaff } from "./staffStore.js";
import { annotateUpstreamOrder, completeUpstreamOrder } from "./upstream.js";

const app = express();
const port = Number(process.env.PORT ?? 7642);
const sessionPath = path.resolve("data/sessions.json");
const { sessions, staffSessions } = loadSessions();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) cb(new Error("只允许上传图片"));
    else cb(null, true);
  }
});
const uploadSingleFile = upload.single("file");

app.use(express.json({ limit: "4mb" }));

function loadSessions() {
  try {
    const raw = JSON.parse(readFileSync(sessionPath, "utf8"));
    return {
      sessions: new Set(raw.admin ?? []),
      staffSessions: new Map(Object.entries(raw.staff ?? {}))
    };
  } catch {
    return {
      sessions: new Set(),
      staffSessions: new Map()
    };
  }
}

function persistSessions() {
  mkdirSync(path.dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, JSON.stringify({
    admin: Array.from(sessions),
    staff: Object.fromEntries(staffSessions)
  }, null, 2));
}

function getToken(req) {
  const header = req.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function requireAdmin(req, res, next) {
  if (!sessions.has(getToken(req))) {
    res.status(401).json({ message: "请先登录" });
    return;
  }
  next();
}

function requireStaff(req, res, next) {
  const staff = staffSessions.get(getToken(req));
  if (!staff) {
    res.status(401).json({ message: "请先登录" });
    return;
  }
  req.staff = staff;
  next();
}

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    uploadSingleFile(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function handleImageUpload(req, res, folder) {
  try {
    await runUpload(req, res);
    if (!req.file) {
      res.status(400).json({ message: "未收到图片" });
      return;
    }

    const url = await uploadBuffer(req.file.buffer, req.file.originalname, folder);
    res.json({ url });
  } catch (err) {
    const message = err?.code === "LIMIT_FILE_SIZE"
      ? "图片不能超过 20MB"
      : err?.message || "截图上传失败";
    res.status(400).json({ message });
  }
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body ?? {};
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    res.status(401).json({ message: "账号或密码错误" });
    return;
  }

  const token = crypto.randomUUID();
  sessions.add(token);
  persistSessions();
  res.json({ token, username });
});

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  res.json({ orders: await readAdminOrders(req.query.scope || "active") });
});

app.get("/api/admin/staff", requireAdmin, async (_req, res) => {
  const staff = await readStaff();
  res.json({ staff: staff.map(({ password, ...item }) => item) });
});

app.post("/api/admin/staff", requireAdmin, async (req, res) => {
  try {
    const item = await createStaff(req.body ?? {});
    const { password, ...safeItem } = item;
    res.json({ staff: safeItem });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.post("/api/admin/import", requireAdmin, async (req, res) => {
  const { orders, pages, stoppedReason } = await fetchThirdPartyOrderPages(req.body ?? {});
  const result = await importOrders(orders);
  res.json({ ...result, imported: orders.length, pages, stoppedReason });
});

app.post("/api/admin/import-html", requireAdmin, async (req, res) => {
  const orders = parseAfterSalesOrders(req.body?.html ?? "");
  const result = await importOrders(orders);
  res.json({ ...result, imported: orders.length });
});

app.post("/api/admin/dedupe", requireAdmin, async (_req, res) => {
  res.json(await dedupeExistingOrders());
});

app.post("/api/admin/upload", requireAdmin, async (req, res) => {
  await handleImageUpload(req, res, "after-sales/screenshots");
});

app.patch("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  const order = await updateOrder(req.params.id, req.body ?? {});
  if (!order) {
    res.status(404).json({ message: "订单不存在" });
    return;
  }
  res.json({ order });
});

app.post("/api/admin/orders/:id/discussion", requireAdmin, async (req, res) => {
  const result = await addAdminDiscussion(req.params.id, req.body?.content);
  if (!result) {
    res.status(404).json({ message: "订单不存在" });
    return;
  }
  if (result.empty) {
    res.status(400).json({ message: "请输入回复内容" });
    return;
  }
  res.json(result);
});

app.post("/api/admin/orders/:id/upstream-note", requireAdmin, async (req, res) => {
  try {
    const orders = await readOrders();
    const order = orders.find((item) => item.id === req.params.id);
    const note = String(req.body?.note ?? "").trim();

    if (!order) {
      res.status(404).json({ message: "订单不存在" });
      return;
    }
    if (!order.sourceId) {
      res.status(400).json({ message: "缺少上游订单 ID，无法标注" });
      return;
    }
    if (!note) {
      res.status(400).json({ message: "请输入标注内容" });
      return;
    }

    await annotateUpstreamOrder(order.sourceId, note);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ message: err.message || "上游标注失败" });
  }
});

app.post("/api/admin/orders/:id/upstream-complete", requireAdmin, async (req, res) => {
  try {
    const orders = await readOrders();
    const order = orders.find((item) => item.id === req.params.id);

    if (!order) {
      res.status(404).json({ message: "订单不存在" });
      return;
    }
    if (!order.sourceId) {
      res.status(400).json({ message: "缺少上游订单 ID，无法完结" });
      return;
    }

    await completeUpstreamOrder(order.sourceId);
    const updatedOrder = await updateOrder(order.id, {
      processStatus: "已回款",
      status: "completed",
      wageStatus: "工资待结",
      commissionAmount: Number.isFinite(Number(order.commissionAmount)) ? Number(order.commissionAmount) : 3,
      completedAt: new Date().toISOString()
    });
    const { orders: remoteOrders, pages, stoppedReason } = await fetchThirdPartyOrderPages({});
    const syncResult = await importOrders(remoteOrders);

    res.json({
      order: updatedOrder,
      sync: {
        ...syncResult,
        imported: remoteOrders.length,
        pages,
        stoppedReason
      }
    });
  } catch (err) {
    res.status(502).json({ message: err.message || "上游完结失败" });
  }
});

app.post("/api/staff/login", async (req, res) => {
  const staff = await verifyStaff(req.body?.account, req.body?.password);
  if (!staff) {
    res.status(401).json({ message: "账号或密码错误" });
    return;
  }

  const token = crypto.randomUUID();
  const safeStaff = { id: staff.id, account: staff.account, name: staff.name };
  staffSessions.set(token, safeStaff);
  persistSessions();
  res.json({ token, staff: safeStaff });
});

app.get("/api/staff/orders", requireStaff, async (req, res) => {
  res.json({ orders: await readStaffOrders(req.staff, req.query.status || "", req.query.scope || "active") });
});

app.get("/api/staff/claimable", requireStaff, async (req, res) => {
  res.json({ orders: await readClaimableOrders(req.query.status || "") });
});

app.post("/api/staff/claim", requireStaff, async (req, res) => {
  const order = await claimNextOrder(req.staff);
  if (!order) {
    res.status(404).json({ message: "暂无可领取工单" });
    return;
  }
  res.json({ order });
});

app.post("/api/staff/claim/:id", requireStaff, async (req, res) => {
  const order = await claimOrderById(req.params.id, req.staff);
  if (!order) {
    res.status(409).json({ message: "该工单已被领取或不可领取" });
    return;
  }
  res.json({ order });
});

app.patch("/api/staff/orders/:id", requireStaff, async (req, res) => {
  const order = await updateStaffOrder(req.params.id, req.staff, req.body ?? {});
  if (!order) {
    res.status(404).json({ message: "工单不存在或不属于当前员工" });
    return;
  }
  res.json({ order });
});

app.post("/api/staff/orders/:id/discussion", requireStaff, async (req, res) => {
  const result = await addStaffDiscussion(req.params.id, req.staff, req.body?.content);
  if (!result) {
    res.status(404).json({ message: "工单不存在或不属于当前员工" });
    return;
  }
  if (result.empty) {
    res.status(400).json({ message: "请输入留言内容" });
    return;
  }
  res.json(result);
});

app.post("/api/staff/upload", requireStaff, async (req, res) => {
  await handleImageUpload(req, res, "after-sales/staff-screenshots");
});

app.use("/uploads", express.static(path.resolve("data/uploads")));
app.use(express.static("dist"));

app.get(["/m/admin", "/m/admin/*"], (_req, res) => {
  res.sendFile(path.resolve("dist/index.html"));
});

app.listen(port, () => {
  console.log(`After-sales API listening on http://localhost:${port}`);
});
