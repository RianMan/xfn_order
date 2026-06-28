import * as cheerio from "cheerio";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { THIRD_PARTY_BASE_URL, THIRD_PARTY_COOKIE, WECHAT_DB_PATH } from "./config.js";

function cleanImageUrl(url) {
  if (!url) return "";
  return String(url).split("?")[0].replace(/!(thumb|small|medium|large|w\d+|h\d+)[^/]*$/i, "");
}

function maskShopName(name) {
  const chars = Array.from(String(name || "").trim());
  if (chars.length <= 2) return chars.join("");
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars.at(-1)}`;
}

function orderStatusLabel($, sourceId) {
  return $(`span[id="${sourceId}"]`)
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .find((text) => text && !["发货失败", "备注", "复制"].includes(text)) || "";
}

function parseOrderQueryHtml(html) {
  const $ = cheerio.load(html);
  const orderMap = new Map();
  const expressNos = [];

  $("img.wuliu").each((_, el) => {
    const no = ($(el).attr("id") || "").trim();
    if (no && !expressNos.includes(no)) expressNos.push(no);
  });

  $("div.imgyulan").each((_, div) => {
    try {
      const rawTitle = ($(div).attr("data-title") || "{}")
        .replace(/&quot;/g, "\"")
        .replace(/&amp;/g, "&")
        .replace(/<[^>]+>/g, "");
      const info = JSON.parse(rawTitle);
      if (!info.id) return;

      const style = $(div).attr("style") || "";
      const bgMatch = style.match(/url\(['"]?(https?[^'")\s]+)['"]?\)/i);
      let screenshotUrl = cleanImageUrl(bgMatch?.[1] || "");
      if (!screenshotUrl) {
        screenshotUrl = cleanImageUrl($(div).find("img").first().attr("src") || "");
      }

      const sourceId = String(info.id);
      const existing = orderMap.get(sourceId);
      if (existing) {
        if (screenshotUrl && !existing.screenshotUrls.includes(screenshotUrl)) {
          existing.screenshotUrls.push(screenshotUrl);
        }
        return;
      }

      const fallbackExpressNos = String(info.kddh || "")
        .split(/[,，、\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);

      orderMap.set(sourceId, {
        sourceId,
        systemId: sourceId,
        orderNo: ($(div).attr("data-title2") || "").replace("订单编号：", "").trim(),
        phone: info.zuodanren || "",
        productName: $(div).attr("data-spname") || "",
        productDesc: info.type || "",
        price: Number.parseFloat(info.jiage) || 0,
        status: orderStatusLabel($, sourceId) || String(info.zt || ""),
        expressNos: expressNos.length ? [...expressNos] : fallbackExpressNos,
        expressCo: info.kdgs || "",
        shop: info.dpname || "",
        shopMasked: maskShopName(info.dpname || ""),
        uploadTime: info.shangchuantime || "",
        remark: $(div).attr("data-sj4") || "",
        screenshotUrls: screenshotUrl ? [screenshotUrl] : []
      });
    } catch {
      // Ignore malformed preview blocks from the upstream HTML.
    }
  });

  return [...orderMap.values()]
    .sort((a, b) => {
      const ta = Date.parse(String(a.uploadTime || "").replace(" ", "T")) || 0;
      const tb = Date.parse(String(b.uploadTime || "").replace(" ", "T")) || 0;
      if (tb !== ta) return tb - ta;
      return Number(b.sourceId || 0) - Number(a.sourceId || 0);
    })
    .map((item, index) => ({ ...item, sortNo: index + 1 }));
}

function readInviter(phone) {
  const cleanPhone = String(phone || "").trim();
  if (!cleanPhone || !existsSync(WECHAT_DB_PATH)) return "";

  let db;
  try {
    db = new DatabaseSync(WECHAT_DB_PATH, { readOnly: true });
    const row = db.prepare("SELECT inviter FROM members WHERE phone = ?").get(cleanPhone);
    return row?.inviter || "";
  } catch {
    return "";
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close errors for this optional lookup.
    }
  }
}

export async function queryUpstreamOrder(orderNo) {
  const keyword = String(orderNo || "").trim();
  if (!keyword) return { success: false, msg: "请输入订单号" };
  if (!THIRD_PARTY_COOKIE) return { success: false, msg: "系统配置缺失，请联系管理员" };

  const body = new URLSearchParams({
    p: "1",
    fenyei: "10",
    zhuangtai: "",
    sousuo: "",
    dianpumingzi: "全部店铺",
    sousuoid: "",
    shangpingbianma: "",
    shangpingmingcheng: "",
    paixutime: "导入时间降序",
    shijian: "",
    shijianend: "",
    shijiantype: "导入时间",
    beizhuneirong: "",
    shangjiadingdanbianhao: keyword,
    jiedanyonghu: "",
    suodingzhuangtai: "全部状态",
    kuaidigongsi: "全部快递"
  });

  const response = await fetch(`${THIRD_PARTY_BASE_URL}/api/admin/index-api.php`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      cookie: THIRD_PARTY_COOKIE,
      "x-requested-with": "XMLHttpRequest",
      "user-agent": "Mozilla/5.0 AfterSalesOrderQuery/0.1"
    },
    body,
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`第三方接口请求失败：${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  if (html.trim().startsWith("<html") || html.includes("登录")) {
    return { success: false, msg: "第三方登录已过期，请联系管理员更新 Cookie" };
  }

  const results = parseOrderQueryHtml(html).map((item) => ({
    ...item,
    inviter: readInviter(item.phone)
  }));
  return {
    success: true,
    results,
    msg: results.length ? "" : "未找到该订单，请确认订单号是否正确"
  };
}
