import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
const start = source.indexOf('app.post("/api/admin/orders/:id/upstream-complete"');
const end = source.indexOf('\napp.post(', start + 1);
assert.ok(start >= 0 && end > start);
const route = source.slice(start, end);

async function invoke({ order = { id: "local-id", sourceId: "upstream-id", commissionAmount: 3 }, body = {}, upstreamError = false } = {}) {
  let handler;
  const calls = [];
  const response = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
  vm.runInNewContext(route, {
    app: { post(_path, _auth, callback) { handler = callback; } },
    requireSuperAdmin() {},
    readOrders: async () => order ? [order] : [],
    completeUpstreamOrder: async (id) => {
      calls.push({ type: "upstream", id });
      if (upstreamError) throw new Error("upstream unavailable");
    },
    updateOrder: async (id, patch) => {
      calls.push({ type: "local", id, patch });
      return { ...order, ...patch };
    },
    fetchThirdPartyOrderPages: async () => { throw new Error("Must not fetch upstream lists after completion"); },
    importOrders: async () => { throw new Error("Must not import upstream orders after completion"); }
  });
  await handler({ params: { id: "local-id" }, body }, response);
  return { calls, response };
}

const success = await invoke({ body: { internalRemark: "保留本次备注", recoveryAmount: "18", commissionAmount: 5 } });
assert.equal(success.response.code, 200);
assert.deepEqual(success.calls.map(call => call.type), ["upstream", "local"]);
assert.equal(success.calls[0].id, "upstream-id");
assert.equal(success.calls[1].id, "local-id");
assert.equal(success.response.data.order.status, "completed");
assert.equal(success.response.data.order.processStatus, "已回款");
assert.equal(success.response.data.order.internalRemark, "保留本次备注");
assert.equal(success.response.data.order.recoveryAmount, "18");
assert.equal(success.response.data.order.commissionAmount, 5);
assert.ok(success.response.data.order.completedAt);
assert.equal("sync" in success.response.data, false);
const failed = await invoke({ upstreamError: true });
assert.equal(failed.response.code, 502);
assert.deepEqual(failed.calls.map(call => call.type), ["upstream"]);
const absent = await invoke({ order: null });
assert.equal(absent.response.code, 404);
assert.equal(absent.calls.length, 0);
const missingSource = await invoke({ order: { id: "local-id" } });
assert.equal(missingSource.response.code, 400);
assert.equal(missingSource.calls.length, 0);
console.log("upstream completion: one upstream call, local state and edits saved, no batch sync, failure and missing-order guards passed");
