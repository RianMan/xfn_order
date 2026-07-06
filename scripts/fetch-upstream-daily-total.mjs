import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ENDPOINT = "https://enff8jbe9flh3mk9.lhxcx1.com/api/admin/index-api.php";
const DEFAULT_COOKIE = "uservip=18167274519; PHPSESSID=pg2kpfq2m4lavk5a3fqqbiq53o";
const DEFAULT_START_DATE = "2026-03-08";

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function todayInShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function parseDate(value) {
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) throw new Error(`日期格式不正确：${value}`);
  return date;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function eachDate(startDate, endDate) {
  const result = [];
  const cursor = parseDate(startDate);
  const end = parseDate(endDate);
  while (cursor <= end) {
    result.push(formatDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function buildBody(date) {
  return new URLSearchParams({
    p: "1",
    fenyei: "10",
    zhuangtai: "888",
    sousuo: "",
    dianpumingzi: "全部店铺",
    sousuoid: "",
    shangpingbianma: "",
    shangpingmingcheng: "",
    paixutime: "发货成功降序",
    shijian: date,
    shijianend: date,
    shijiantype: "发货成功时间",
    beizhuneirong: "",
    shangjiadingdanbianhao: "",
    jiedanyonghu: "",
    suodingzhuangtai: "全部状态",
    kuaidigongsi: "全部快递"
  });
}

function parseTotalAmount(html) {
  const match = String(html).match(/总金额：\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return "";
  return match[1];
}

async function fetchDailyTotal(date, cookie) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      accept: "*/*",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      cookie,
      origin: "https://enff8jbe9flh3mk9.lhxcx1.com",
      referer: "https://enff8jbe9flh3mk9.lhxcx1.com/admin/1.php",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      "x-requested-with": "XMLHttpRequest"
    },
    body: buildBody(date)
  });

  const html = await response.text();
  if (!response.ok) {
    throw new Error(`${date} 请求失败：HTTP ${response.status}`);
  }
  return {
    date,
    amount: parseTotalAmount(html),
    ok: html.includes("总金额")
  };
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function main() {
  const startDate = argValue("start", DEFAULT_START_DATE);
  const endDate = argValue("end", todayInShanghai());
  const cookie = process.env.UPSTREAM_COOKIE || argValue("cookie", DEFAULT_COOKIE);
  const output = argValue("output", path.join("reports", `upstream-daily-total-${startDate}_to_${endDate}.csv`));
  const dates = eachDate(startDate, endDate);
  const rows = [];

  for (const date of dates) {
    try {
      const row = await fetchDailyTotal(date, cookie);
      rows.push(row);
      console.log(`${date} ${row.amount || "未解析到金额"}`);
    } catch (err) {
      rows.push({ date, amount: "", ok: false, error: err.message });
      console.error(`${date} ${err.message}`);
    }
  }

  const lines = [
    ["日期", "金额"].map(csvCell).join(","),
    ...rows.map((row) => [row.date, row.amount].map(csvCell).join(","))
  ];
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `\uFEFF${lines.join("\n")}\n`, "utf8");
  console.log(`已导出：${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
