import "./env.js";

export const ADMIN_USER = process.env.ADMIN_USER || "xiaofuniya";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "abcd1234";

export const THIRD_PARTY_URL =
  process.env.THIRD_PARTY_URL || "https://enff8jbe9flh3mk9.lhxcx1.com/api/admin/index9-api.php";

export const THIRD_PARTY_COOKIE = process.env.THIRD_PARTY_COOKIE || "";

export const THIRD_PARTY_BASE_URL = process.env.THIRD_PARTY_BASE_URL || "https://enff8jbe9flh3mk9.lhxcx1.com";

export const WECHAT_DB_PATH = process.env.WECHAT_DB_PATH || "/Users/shawvi/Desktop/wechat/data/orders.db";

export const DEFAULT_IMPORT_PAYLOAD = {
  p: "1",
  fenyei: "10",
  sousuo: "",
  suoshudianpu: "全部店铺",
  shangchuan: "已上传",
  dangshizhuangtai: "全部类型",
  chulizhuangtai: "0"
};
