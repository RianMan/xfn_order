import { fetchThirdPartyOrderPages } from "./importer.js";
import { importOrders } from "./store.js";
import { pathToFileURL } from "node:url";

export async function syncUpstreamOrders(payload = {}) {
  const requestPayload = {
    p: process.env.SYNC_PAGE || "1",
    fenyei: process.env.SYNC_PAGE_SIZE || "50",
    maxPages: process.env.SYNC_MAX_PAGES || "50",
    ...payload
  };

  const { orders, pages, stoppedReason } = await fetchThirdPartyOrderPages(requestPayload);
  const result = await importOrders(orders);
  return {
    imported: orders.length,
    pages,
    stoppedReason,
    ...result
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  console.log(JSON.stringify(await syncUpstreamOrders(), null, 2));
}
