import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { parseAfterSalesOrders, maskShopName } from "./parser.js";

const sample = await readFile(
  "/Users/shawvi/.codex/attachments/bc1b035b-463f-4e5a-9dc3-feb5736237a8/pasted-text.txt",
  "utf8"
);

const orders = parseAfterSalesOrders(sample);

assert.equal(maskShopName("唯选优品汇"), "唯***汇");
assert.equal(orders.length, 9);
assert.equal(orders[0].orderNumber, "260611-113676173704092");
assert.equal(orders[0].receivedAt, "2026-06-23 19:02:47");
assert.deepEqual(orders[0].phones, [
  "18539983171",
  "18770951931",
  "15215115097",
  "13967686619",
  "15777486058"
]);
assert.equal(orders[0].shopName, "唯选优品汇");
assert.equal(orders[0].maskedShopName, "唯***汇");
assert.equal(orders[0].refundInfo, "退货退款");

const wrongStatus = sample.replaceAll("发货成功-已打款", "发货列表");
assert.equal(parseAfterSalesOrders(wrongStatus).length, 0);

const noCompleteAction = sample.replaceAll("chuliwanbi", "done-hidden").replaceAll("处理完成", "已处理");
assert.equal(parseAfterSalesOrders(noCompleteAction).length, 0);

const resendHtml = `
<table>
  <tr>
    <td>
      <span>发货成功-已打款</span>
      订单编号：260610-503746434600265
      <span>等待处理</span> 阳阳家的铺子吖
      <span class="yilianxi">备注</span>
      <span class="chuliwanbi">处理完成</span>
    </td>
  </tr>
  <tr>
    <td><div>申请时间：2026-06-22 17:09:59</div><div>接收时间：2026-06-22 17:10:03</div><div>处理时间：0000-00-00 00:00:00</div></td>
    <td>19958874855 <span>复制</span></td>
    <td><div>补寄</div></td>
    <td><div></div></td>
  </tr>
</table>`;
const resendOrders = parseAfterSalesOrders(resendHtml);
assert.equal(resendOrders.length, 1);
assert.equal(resendOrders[0].refundInfo, "补寄");

console.log(`parser ok: ${orders.length} orders`);
