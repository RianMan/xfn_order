import * as cheerio from "cheerio";

const PHONE_RE = /(?<!\d)1\d{10}(?!\d)/g;
const ORDER_RE = /订单编号[:：]\s*([A-Za-z0-9-]+)/;
const RECEIVED_RE = /接收时间[:：]\s*([0-9-:\s]+)/;
const APPLIED_RE = /申请时间[:：]\s*([0-9-:\s]+)/;
const HANDLED_RE = /处理时间[:：]\s*([0-9-]{10}\s+[0-9:]{8})/;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function pickShopName(headerText) {
  const waitingMatch = headerText.match(/等待处理\s*([^\s]+)/);
  if (waitingMatch) return waitingMatch[1];

  const withoutOrder = headerText.replace(/订单编号[:：]\s*[A-Za-z0-9-]+/g, "");
  const candidates = withoutOrder.match(/[\u4e00-\u9fa5A-Za-z0-9]+/g) ?? [];
  return candidates
    .filter((item) => !/发货|打款|状态|复制|备注|处理完成|等待处理/.test(item))
    .at(-1) ?? "";
}

function maskShopName(name) {
  if (!name) return "";
  const chars = Array.from(name);
  if (chars.length <= 2) return name;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars.at(-1)}`;
}

function extractRefundInfo($, detailRow) {
  const cells = $(detailRow).children("td").toArray();
  const candidate = cells
    .map((cell) => cleanText($(cell).text()))
    .find((text) => /退货|退款|换货|补发|补寄|售后/.test(text) && !/申请时间|接收时间|处理时间/.test(text));
  return candidate ?? "";
}

function extractRemark($, detailRow) {
  const cells = $(detailRow).children("td").toArray();
  const lastText = cleanText($(cells.at(-1)).text());
  return lastText.replace(/^备注[:：]\s*/, "");
}

export function parseAfterSalesOrders(html) {
  const $ = cheerio.load(html);
  const orders = [];

  $("tr").each((_, headerRow) => {
    const headerText = cleanText($(headerRow).text());
    const orderMatch = headerText.match(ORDER_RE);
    if (!orderMatch) return;

    const sourceStatus = cleanText($(headerRow).find("span").first().text());
    if (sourceStatus !== "发货成功-已打款") return;

    const hasRemarkAction = $(headerRow).find(".yilianxi").length > 0 || /备注/.test(headerText);
    const hasCompleteAction = $(headerRow).find(".chuliwanbi").length > 0 || /处理完成/.test(headerText);
    if (!hasRemarkAction || !hasCompleteAction) return;

    const detailRow = $(headerRow).nextAll("tr").toArray().find((row) => {
      const text = cleanText($(row).text());
      return RECEIVED_RE.test(text) && PHONE_RE.test(text);
    });
    if (!detailRow) return;

    const detailText = cleanText($(detailRow).text());
    const remark = extractRemark($, detailRow);
    if (remark.includes("等寄出")) return;

    const sourceId =
      $(headerRow).find('input[name="optionGroup"]').attr("value") ||
      $(headerRow).find(".chuliwanbi").attr("id") ||
      "";
    const orderNumber = orderMatch[1];
    const receivedAt = detailText.match(RECEIVED_RE)?.[1]?.trim() ?? "";
    const shopName = pickShopName(headerText);

    orders.push({
      importKey: sourceId || `${orderNumber}-${receivedAt}`,
      sourceId,
      orderNumber,
      appliedAt: detailText.match(APPLIED_RE)?.[1]?.trim() ?? "",
      receivedAt,
      handledAt: detailText.match(HANDLED_RE)?.[1]?.trim() ?? "",
      phones: Array.from(new Set(detailText.match(PHONE_RE) ?? [])),
      shopName,
      maskedShopName: maskShopName(shopName),
      refundInfo: extractRefundInfo($, detailRow),
      sourceStatus,
      remark
    });
  });

  return orders;
}

export { maskShopName };
