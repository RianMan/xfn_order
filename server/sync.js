import { fetchThirdPartyOrderPages } from "./importer.js";
import { importOrders } from "./store.js";

const payload = {
  p: process.env.SYNC_PAGE || "1",
  fenyei: process.env.SYNC_PAGE_SIZE || "50",
  maxPages: process.env.SYNC_MAX_PAGES || "50"
};

const { orders, pages, stoppedReason } = await fetchThirdPartyOrderPages(payload);
const result = await importOrders(orders);

console.log(
  JSON.stringify(
    {
      imported: orders.length,
      pages,
      stoppedReason,
      ...result
    },
    null,
    2
  )
);
