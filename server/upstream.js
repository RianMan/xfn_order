import { THIRD_PARTY_BASE_URL, THIRD_PARTY_COOKIE } from "./config.js";

async function postUpstream(path, payload) {
  if (!THIRD_PARTY_COOKIE) {
    throw new Error("缺少三方 Cookie 配置：THIRD_PARTY_COOKIE");
  }

  const response = await fetch(`${THIRD_PARTY_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      cookie: THIRD_PARTY_COOKIE,
      "user-agent": "Mozilla/5.0 AfterSalesAdmin/0.1"
    },
    body: new URLSearchParams(payload)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`三方接口请求失败：${response.status} ${response.statusText}`);
  }

  return text;
}

export function annotateUpstreamOrder(sourceId, note) {
  return postUpstream("/api/admin/lianxiqingkuang.php", {
    id: sourceId,
    lianxiqingkuang: note
  });
}

export function completeUpstreamOrder(sourceId) {
  return postUpstream("/api/admin/chuliwanbi.php", {
    id: sourceId
  });
}
