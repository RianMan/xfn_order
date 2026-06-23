import { fetchThirdPartyOrders } from "./importer.js";
import { importOrders } from "./store.js";

const payload = {
  p: process.env.SYNC_PAGE || "1",
  fenyei: process.env.SYNC_PAGE_SIZE || "50"
};

const { orders } = await fetchThirdPartyOrders(payload);
const result = await importOrders(orders);

console.log(
  JSON.stringify(
    {
      imported: orders.length,
      ...result
    },
    null,
    2
  )
);
