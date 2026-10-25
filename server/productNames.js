import { queryUpstreamOrder } from "./orderQuery.js";

function validPrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function missingProductDetails(order, details = {}) {
  const patch = {};
  if (!String(order.productName || "").trim() && details.productName) patch.productName = details.productName;
  for (const field of ["productSalePrice", "productPurchasePrice"]) {
    if (!validPrice(order[field]) && validPrice(details[field])) patch[field] = details[field];
  }
  return patch;
}

function complete(details) {
  return details?.productName && validPrice(details.productSalePrice) && validPrice(details.productPurchasePrice);
}

// Only accept exact order-number matches; the upstream search may return similar orders.
export async function fetchProductNames(orders, existingOrders = []) {
  const details = new Map();
  for (const order of [...existingOrders, ...orders]) {
    const number = String(order.orderNumber || "").trim();
    const known = details.get(number) || {};
    details.set(number, { ...known, ...missingProductDetails(known, order) });
  }
  const pending = [...new Set(orders.map((order) => String(order.orderNumber || "").trim()))]
    .filter((number) => number && !complete(details.get(number)));
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
        const found = { productName: productNames.join(" / ") };
        for (const field of ["productSalePrice", "productPurchasePrice"]) {
          // Different upstream rows may represent different goods; do not invent an order price.
          const prices = [...new Set(matches.map((item) => item[field]))];
          found[field] = prices.length === 1 && validPrice(prices[0]) ? prices[0] : null;
        }
        const known = details.get(number) || {};
        const merged = { ...known, ...missingProductDetails(known, found) };
        details.set(number, merged);
        if (!complete(merged)) failed += 1;
      } catch {
        // A failed optional lookup must not prevent after-sales orders from being imported.
        failed += 1;
      }
    }
  }));
  const names = new Map([...details].filter(([, item]) => item.productName).map(([number, item]) => [number, item.productName]));
  return { names, details, failed };
}
