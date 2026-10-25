import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const previousCwd = process.cwd();
const scratch = await mkdtemp(path.join(tmpdir(), 'xfn-products-'));
process.chdir(scratch);
process.env.THIRD_PARTY_COOKIE = 'test-cookie';
process.env.WECHAT_DB_PATH = path.join(scratch, 'absent.db');
const originalFetch = globalThis.fetch;
const { getDb, saveOrderRow } = await import('./db.js');
const { importOrders, readOrders } = await import('./store.js');
const { fetchProductNames } = await import('./productNames.js');
const base = { receivedAt: '2026-10-24 20:49:02', processStatus: '联系中', internalRemark: '保留备注', assigneeAccount: 'staff-a' };
const input = (number) => ({ ...base, orderNumber: number, sourceId: number });
const existing = { ...input('existing'), id: 'existing-id', productName: '' };
saveOrderRow(existing);
saveOrderRow({ ...input('cached'), id: 'cached-id', productName: '已保存的商品', productSalePrice: 0, productPurchasePrice: 0 });
saveOrderRow({ ...input('named'), id: 'named-id', productName: '已有名称' });
let active = 0;
let peak = 0;
const calls = [];
function preview(number, product, id = 1, purchase = 18, sale = 21.88) {
  return `<table><tr><td><div class="imgyulan" data-title='${JSON.stringify({ id, jiage: purchase })}' data-title2="订单编号：${number}" data-spname="${product}"></div>${sale === null ? '' : `<div>售价：${sale}<span>改</span></div>`}</td></tr></table>`;
}
globalThis.fetch = async (_url, options) => {
  const number = new URLSearchParams(options.body).get('shangjiadingdanbianhao');
  calls.push(number);
  active += 1;
  peak = Math.max(peak, active);
  await new Promise(resolve => setImmediate(resolve));
  active -= 1;
  if (number === 'existing') saveOrderRow({ ...existing, processStatus: '已回款', recoveryAmount: '38', internalRemark: '查询期间新备注' });
  if (number === 'failure') throw new Error('upstream unavailable');
  let html = preview(number, '商品-' + number);
  if (number === 'mismatch') html = preview('mismatch-extra', '不应串入');
  if (number === 'zero') html = preview(number, '零价格', 1, 0, 0);
  if (number === 'missing') html = preview(number, '无价格', 1, null, null);
  if (number === 'invalid') html = preview(number, '无效价格', 1, 'invalid', 'invalid');
  if (number === 'different') html = preview(number, '商品甲', 1, 18, 21.88) + preview(number, '商品乙', 2, 20, 25);
  if (number === 'multi') html = preview(number, '商品甲', 1) + preview(number, '商品乙', 2);
  return { ok: true, text: async () => html };
};
try {
  const result = await importOrders([
    input('existing'), input('new'), input('new'), input('failure'), input('mismatch'), input('multi'), input('cached'), input('named'),
    { ...input('old'), receivedAt: '2026-06-01 00:00:00' }
  ]);
  assert.equal(result.created, 4);
  assert.equal(result.skippedDuplicate, 4);
  assert.equal(result.skippedOld, 1);
  assert.equal(result.productNamesUpdated, 1);
  assert.equal(result.productPricesUpdated, 2);
  assert.equal(result.productLookupFailed, 2);
  assert.ok(result.backupPath);
  assert.equal(peak, 3);
  assert.equal(new Set(calls).size, calls.length);
  assert.equal(calls.length, 6);
  assert.ok(!calls.includes('old') && !calls.includes('cached'));
  const orders = new Map((await readOrders()).map(order => [order.orderNumber, order]));
  assert.equal(orders.get('existing').productName, '商品-existing');
  assert.equal(orders.get('existing').processStatus, '已回款');
  assert.equal(orders.get('existing').recoveryAmount, '38');
  assert.equal(orders.get('existing').internalRemark, '查询期间新备注');
  assert.equal(orders.get('existing').assigneeAccount, 'staff-a');
  assert.equal(orders.get('new').productName, '商品-new');
  assert.equal(orders.get('new').productSalePrice, 21.88);
  assert.equal(orders.get('new').productPurchasePrice, 18);
  assert.equal(orders.get('existing').productSalePrice, 21.88);
  assert.equal(orders.get('existing').productPurchasePrice, 18);
  assert.equal(orders.get('named').productName, '已有名称');
  assert.equal(orders.get('named').productSalePrice, 21.88);
  assert.equal(orders.get('named').productPurchasePrice, 18);
  assert.equal(orders.get('cached').productSalePrice, 0);
  assert.equal(orders.get('cached').productPurchasePrice, 0);
  assert.equal(orders.get('cached').productName, '已保存的商品');
  assert.equal(orders.get('failure').productName, '');
  assert.equal(orders.get('mismatch').productName, '');
  assert.deepEqual(new Set(orders.get('multi').productName.split(' / ')), new Set(['商品甲', '商品乙']));
  const before = calls.length;
  await importOrders([input('existing'), input('new'), input('cached')]);
  assert.equal(calls.length, before);
  const extra = await fetchProductNames(['zero', 'missing', 'invalid', 'different'].map(input));
  assert.equal(extra.details.get('zero').productSalePrice, 0);
  assert.equal(extra.details.get('zero').productPurchasePrice, 0);
  for (const number of ['missing', 'invalid', 'different']) {
    assert.equal(extra.details.get(number).productSalePrice ?? null, null);
    assert.equal(extra.details.get(number).productPurchasePrice ?? null, null);
  }
  assert.equal(extra.failed, 3);
  globalThis.fetch = async () => ({ ok: true, text: async () => '<html>登录</html>' });
  const expired = await fetchProductNames([input('expired')]);
  assert.equal(expired.failed, 1);
  assert.equal(expired.names.has('expired'), false);
  console.log('product details: names, sale/purchase prices, zero/missing/invalid/conflicting prices, backfill, staff changes, deduplication, caching, concurrency and failures passed');
} finally {
  globalThis.fetch = originalFetch;
  getDb().close();
  process.chdir(previousCwd);
  await rm(scratch, { recursive: true, force: true });
}
