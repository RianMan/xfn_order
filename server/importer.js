import { DEFAULT_IMPORT_PAYLOAD, THIRD_PARTY_COOKIE, THIRD_PARTY_URL } from "./config.js";
import { parseAfterSalesOrders } from "./parser.js";

const MIN_RECEIVED_DATE = "2026-06-22 00:00:00";
const DEFAULT_MAX_PAGES = 50;

export async function fetchThirdPartyOrders(payload = {}) {
  const body = new URLSearchParams({
    ...DEFAULT_IMPORT_PAYLOAD,
    ...Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined && value !== null)
    )
  });

  const response = await fetch(THIRD_PARTY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      cookie: THIRD_PARTY_COOKIE,
      "user-agent": "Mozilla/5.0 AfterSalesImporter/0.1"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`第三方接口请求失败：${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return {
    html,
    orders: parseAfterSalesOrders(html)
  };
}

function hasReachedOldData(orders) {
  return orders.some((order) => {
    const date = order.receivedAt || order.appliedAt || "";
    return date && date < MIN_RECEIVED_DATE;
  });
}

export async function fetchThirdPartyOrderPages(payload = {}) {
  const pageSize = String(payload.fenyei || DEFAULT_IMPORT_PAYLOAD.fenyei || "50");
  const startPage = Number(payload.p || DEFAULT_IMPORT_PAYLOAD.p || 1);
  const maxPages = Number(payload.maxPages || process.env.SYNC_MAX_PAGES || DEFAULT_MAX_PAGES);
  const pages = [];
  const orders = [];

  for (let offset = 0; offset < maxPages; offset += 1) {
    const page = startPage + offset;
    const pagePayload = {
      ...payload,
      p: String(page),
      fenyei: pageSize
    };
    delete pagePayload.maxPages;

    const result = await fetchThirdPartyOrders(pagePayload);
    pages.push({
      page,
      count: result.orders.length
    });
    orders.push(...result.orders);

    if (result.orders.length === 0) {
      return { orders, pages, stoppedReason: "empty_page" };
    }

    if (hasReachedOldData(result.orders)) {
      return { orders, pages, stoppedReason: "old_data" };
    }
  }

  return { orders, pages, stoppedReason: "max_pages" };
}
