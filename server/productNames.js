import { queryUpstreamOrder } from "./orderQuery.js";

// Only accept exact order-number matches; the upstream search may return similar orders.
export async function fetchProductNames(orders, existingOrders = []) {
  const names = new Map(existingOrders
    .filter((order) => String(order.productName || "").trim())
    .map((order) => [String(order.orderNumber || "").trim(), order.productName]));
  for (const order of orders) {
    const name = String(order.productName || "").trim();
    if (name) names.set(String(order.orderNumber || "").trim(), name);
  }
  const pending = [...new Set(orders.map((order) => String(order.orderNumber || "").trim()))]
    .filter((number) => number && !names.has(number));
  let cursor = 0;
  let failed = 0;
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (cursor < pending.length) {
      const number = pending[cursor++];
      try {
        const result = await queryUpstreamOrder(number, { includeInviter: false });
        if (!result.success) throw new Error(result.msg || "商品查询失败");
        const matches = result.results.filter((item) => String(item.orderNo || "").trim() === number);
        const productNames = [...new Set(matches.map((item) => String(item.productName || "").trim()).filter(Boolean))];
        if (productNames.length) names.set(number, productNames.join(" / "));
        else failed += 1;
      } catch {
        // A failed optional lookup must not prevent after-sales orders from being imported.
        failed += 1;
      }
    }
  }));
  return { names, failed };
}
