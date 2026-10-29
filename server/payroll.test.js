import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/pages/AdminPage.vue", import.meta.url), "utf8");
const start = source.indexOf("function numberValue(value)");
const end = source.indexOf("async function markSelectedPayrollPaid()", start);
assert.ok(start >= 0 && end > start);
const rows = [];
function add(account, count, wageStatus, commissionAmount = 3, status = "completed") {
  for (let i = 0; i < count; i++) rows.push({ assigneeAccount: account, assigneeName: account, status, wageStatus, commissionAmount, orderNumber: `${account}-${i}`, completedAt: "2026-10-29T00:00:00Z" });
}
add("six", 6, "待发放");
add("twelve", 12, "待发放");
add("carry", 5, "已发放");
add("carry", 1, "待发放");
add("paid-only", 12, "已发放");
add("active", 6, "待发放", 3, "pending");
add("mixed", 1, "待发放", 0);
add("mixed", 1, "待发放", 1);
add("mixed", 1, "待发放", 3);
add("legacy", 1, "工资待结", 5);
let exported;
const warnings = [];
const context = vm.createContext({
  orders: { value: rows },
  computed: (calculate) => ({ get value() { return calculate(); } }),
  EFFECTIVE_ORDER_COMMISSION_THRESHOLD: 3,
  payrollStatus: (value) => ({ 工资待结: "待发放", 工资已结: "已发放" }[value] || value || "待发放"),
  dateOnly: (value) => String(value).slice(0, 10),
  formatMoney: (value) => Number(value || 0).toFixed(2),
  csvCell: (value) => `"${String(value ?? "").replace(/"/g, '""')}"`,
  Blob,
  URL: { createObjectURL: (blob) => { exported = blob; return "blob:test"; }, revokeObjectURL() {} },
  document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
  antMessage: { warning: (message) => warnings.push(message) }
});
vm.runInContext(source.slice(start, end), context);
const summary = vm.runInContext("payrollSummaryRows.value", context);
const byAccount = new Map(summary.map(row => [row.account, row]));
assert.equal(byAccount.get("six").payableAmount, 18);
assert.equal(byAccount.get("twelve").payableAmount, 36);
assert.equal(byAccount.get("carry").payableAmount, 3);
assert.equal(byAccount.get("mixed").payableAmount, 4);
assert.equal(byAccount.get("legacy").payableAmount, 5);
assert.equal(byAccount.has("paid-only"), false);
assert.equal(byAccount.has("active"), false);
for (const row of summary) assert.equal(row.payableAmount, row.commissionAmount);
assert.equal(vm.runInContext("payrollSummaryTotals.value.payableAmount", context), 66);
vm.runInContext("exportPendingPayroll()", context);
const csv = await exported.text();
const lines = csv.replace(/^\uFEFF/, "").split("\n").map(line => line.split(",").map(cell => cell.slice(1, -1)));
const headers = lines.shift();
assert.ok(headers.every(header => !/奖励|结转/.test(header)));
const accountColumn = headers.indexOf("员工账号");
const amountColumn = headers.indexOf("本次应发合计");
const baseColumn = headers.indexOf("基础工资合计");
for (const line of lines) {
  assert.equal(line.length, headers.length);
  assert.equal(line[amountColumn], line[baseColumn]);
  assert.equal(Number(line[amountColumn]), byAccount.get(line[accountColumn]).payableAmount);
}
context.orders.value = [];
vm.runInContext("exportPendingPayroll()", context);
assert.equal(warnings.length, 1);
console.log("payroll: no 6/12-order bonus or historical carry bonus, commissions preserved, paid/active exclusions, legacy status, totals and CSV passed");
