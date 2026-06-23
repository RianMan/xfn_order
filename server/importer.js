import { DEFAULT_IMPORT_PAYLOAD, THIRD_PARTY_COOKIE, THIRD_PARTY_URL } from "./config.js";
import { parseAfterSalesOrders } from "./parser.js";

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
