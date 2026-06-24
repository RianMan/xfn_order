<script setup>
import { computed, reactive, ref } from "vue";
import { PROCESS_OPTIONS } from "../constants.js";

const staffLogin = reactive({ account: "", password: "" });
const staffFilters = reactive({ processStatus: "", refundInfo: "" });
const staffTab = ref("claimable");
const staffPager = reactive({ current: 1, pageSize: 8 });
const staffRemarkDrafts = reactive({});
const staffExpandedOrders = reactive({});
const staffDiscussionDrafts = reactive({});

function readStoredStaff() {
  try {
    return JSON.parse(localStorage.getItem("staffProfile") || "null");
  } catch {
    localStorage.removeItem("staffProfile");
    localStorage.removeItem("staffToken");
    return null;
  }
}

const staff = ref(readStoredStaff());
const staffLoggedIn = ref(Boolean(localStorage.getItem("staffToken") && staff.value));
const staffOrders = ref([]);
const claimableOrders = ref([]);
const staffHistoryOrders = ref([]);
const previewImage = ref("");
const toast = reactive({ show: false, text: "", type: "success", timer: 0 });

function showToast(text, type = "success") {
  toast.text = text;
  toast.type = type;
  toast.show = true;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    toast.show = false;
  }, 1800);
}

function staffHeaders() {
  const token = localStorage.getItem("staffToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function staffRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...staffHeaders(),
      ...(options.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem("staffToken");
    localStorage.removeItem("staffProfile");
    staffLoggedIn.value = false;
    staff.value = null;
    staffOrders.value = [];
    claimableOrders.value = [];
    staffHistoryOrders.value = [];
    throw new Error(data.message || "登录已过期，请重新登录");
  }
  if (!response.ok) throw new Error(data.message || "请求失败");
  return data;
}

async function readUploadResponse(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (response.status === 401) {
    localStorage.removeItem("staffToken");
    localStorage.removeItem("staffProfile");
    staffLoggedIn.value = false;
    staff.value = null;
    staffOrders.value = [];
    claimableOrders.value = [];
    staffHistoryOrders.value = [];
    throw new Error(data.message || "登录已过期，请重新登录");
  }
  if (!response.ok) throw new Error(data.message || "截图上传失败");
  return data;
}

const visibleStaffOrders = computed(() => {
  const source = staffTab.value === "claimable"
    ? claimableOrders.value
    : staffTab.value === "history"
      ? staffHistoryOrders.value
      : staffOrders.value;
  return source.filter((order) => {
    const statusOk = staffTab.value !== "mine" || !staffFilters.processStatus || order.processStatus === staffFilters.processStatus;
    const refundOk = staffTab.value !== "claimable" || !staffFilters.refundInfo || order.refundInfo === staffFilters.refundInfo;
    return statusOk && refundOk;
  });
});

const pagedStaffOrders = computed(() => {
  const start = (staffPager.current - 1) * staffPager.pageSize;
  return visibleStaffOrders.value.slice(start, start + staffPager.pageSize);
});

const claimableRefundOptions = computed(() => {
  return Array.from(new Set(claimableOrders.value.map((order) => order.refundInfo).filter(Boolean)));
});

const claimableFilterOptions = computed(() => ["", ...claimableRefundOptions.value]);

const mineFilterOptions = computed(() => ["", ...PROCESS_OPTIONS]);

async function loginStaff() {
  try {
    const data = await staffRequest("/api/staff/login", {
      method: "POST",
      body: JSON.stringify(staffLogin)
    });
    localStorage.setItem("staffToken", data.token);
    localStorage.setItem("staffProfile", JSON.stringify(data.staff));
    staff.value = data.staff;
    staffLoggedIn.value = true;
    showToast("登录成功");
    await loadStaffOrders();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function logoutStaff() {
  localStorage.removeItem("staffToken");
  localStorage.removeItem("staffProfile");
  staffLoggedIn.value = false;
  staff.value = null;
  staffOrders.value = [];
  claimableOrders.value = [];
  staffHistoryOrders.value = [];
}

function switchStaffTab(tab) {
  staffTab.value = tab;
  staffPager.current = 1;
  if (tab === "claimable") {
    staffFilters.processStatus = "";
  } else if (tab === "mine") {
    staffFilters.refundInfo = "";
  } else {
    staffFilters.refundInfo = "";
    staffFilters.processStatus = "";
  }
}

async function selectStaffFilter(type, value) {
  staffPager.current = 1;
  if (type === "refundInfo") {
    staffFilters.refundInfo = value;
    return;
  }
  staffFilters.processStatus = value;
  await loadStaffOrders();
}

function filterLabel(value, fallback) {
  return value || fallback;
}

async function loadStaffOrders() {
  if (!staffLoggedIn.value) return;
  const query = staffFilters.processStatus ? `?status=${encodeURIComponent(staffFilters.processStatus)}` : "";
  const [mine, claimable] = await Promise.all([
    staffRequest(`/api/staff/orders${query}`),
    staffRequest(`/api/staff/claimable${query}`)
  ]);
  staffOrders.value = mine.orders;
  claimableOrders.value = claimable.orders;
  const history = await staffRequest("/api/staff/orders?scope=history");
  staffHistoryOrders.value = history.orders;
}

async function claimOrder(order) {
  try {
    await staffRequest(`/api/staff/claim/${order.id}`, { method: "POST", body: "{}" });
    showToast("领取成功");
    staffTab.value = "mine";
    await loadStaffOrders();
  } catch (err) {
    showToast(err.message, "warning");
  }
}

function isStaffOrderExpanded(order, index) {
  if (staffTab.value !== "mine") return true;
  if (Object.prototype.hasOwnProperty.call(staffExpandedOrders, order.id)) {
    return staffExpandedOrders[order.id];
  }
  return index === 0;
}

function toggleStaffOrder(order, index) {
  staffExpandedOrders[order.id] = !isStaffOrderExpanded(order, index);
}

async function saveStaffOrder(record, options = {}) {
  const includeRemark = options.includeRemark !== false;
  const remarkAppend = includeRemark ? (staffRemarkDrafts[record.id] || "").trim() : "";
  const data = await staffRequest(`/api/staff/orders/${record.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      processStatus: record.processStatus,
      paymentScreenshots: record.paymentScreenshots || [],
      remarkAppend
    })
  });
  const index = staffOrders.value.findIndex((item) => item.id === data.order.id);
  if (index >= 0) staffOrders.value[index] = data.order;
  if (includeRemark) staffRemarkDrafts[record.id] = "";
  if (!options.silent) showToast("保存成功");
}

async function uploadStaffScreenshot(record, field, file) {
  if (field !== "paymentScreenshots") {
    showToast("员工只能上传收款截图", "error");
    return false;
  }

  try {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/staff/upload", {
      method: "POST",
      headers: staffHeaders(),
      body: form
    });
    const data = await readUploadResponse(response);
    if (!data.url) throw new Error("上传成功但没有返回图片地址");

    record[field] = [...(record[field] || []), data.url];
    await saveStaffOrder(record, { includeRemark: false, silent: true });
    showToast("截图已上传");
  } catch (err) {
    showToast(err.message || "截图上传失败", "error");
  }
  return false;
}

async function handleStaffFileChange(event, record, field) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (file) await uploadStaffScreenshot(record, field, file);
}

async function removeStaffScreenshot(record, field, url) {
  if (field !== "paymentScreenshots") return;
  record[field] = (record[field] || []).filter((item) => item !== url);
  await saveStaffOrder(record, { includeRemark: false, silent: true });
}

function formatDiscussionTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function submitStaffDiscussion(record) {
  const content = String(staffDiscussionDrafts[record.id] || "").trim();
  if (!content) {
    showToast("请输入留言内容", "warning");
    return;
  }

  try {
    const data = await staffRequest(`/api/staff/orders/${record.id}/discussion`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
    const index = staffOrders.value.findIndex((item) => item.id === data.order.id);
    if (index >= 0) staffOrders.value[index] = data.order;
    staffDiscussionDrafts[record.id] = "";
    showToast("已发送");
  } catch (err) {
    showToast(err.message || "发送失败", "error");
  }
}

function openPreview(url) {
  previewImage.value = url;
}

function closePreview() {
  previewImage.value = "";
}

function copy(value) {
  const text = String(value ?? "");
  if (!text) return;

  const fallbackCopy = () => {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast("已复制"))
      .catch(() => {
        if (fallbackCopy()) showToast("已复制");
        else showToast("复制失败，请手动复制", "error");
      });
    return;
  }

  if (fallbackCopy()) showToast("已复制");
  else showToast("复制失败，请手动复制", "error");
}

if (staffLoggedIn.value) loadStaffOrders();
</script>

<template>
  <main v-if="!staffLoggedIn" class="login-screen staff-login-screen">
    <section class="login-card staff-login-card">
      <div class="login-title">
        <span>员工工单系统</span>
        <strong>登录</strong>
      </div>
      <form class="staff-login-form" @submit.prevent="loginStaff">
        <label>
          <span>员工账号</span>
          <input v-model="staffLogin.account" autocomplete="username" placeholder="请输入员工账号" />
        </label>
        <label>
          <span>密码</span>
          <input v-model="staffLogin.password" type="password" autocomplete="current-password" placeholder="请输入密码" />
        </label>
        <button type="submit" class="staff-primary-btn">进入工单系统</button>
      </form>
    </section>
  </main>

  <main v-else class="staff-page">
    <header class="staff-header">
      <div>
        <strong>我的工单</strong>
        <span>{{ staff?.name }}，自己领取工单并处理</span>
      </div>
      <button class="staff-ghost-btn" @click="logoutStaff">退出</button>
    </header>

    <section class="staff-toolbar">
      <div class="staff-tabs">
        <button
          :class="{ active: staffTab === 'claimable' }"
          @click="switchStaffTab('claimable')"
        >
          可领取工单池
        </button>
        <button
          :class="{ active: staffTab === 'mine' }"
          @click="switchStaffTab('mine')"
        >
          我的工单
        </button>
        <button
          :class="{ active: staffTab === 'history' }"
          @click="switchStaffTab('history')"
        >
          处理过的订单
        </button>
      </div>
      <div v-if="staffTab === 'claimable'" class="staff-filter-strip" aria-label="按售后信息筛选">
        <button
          v-for="item in claimableFilterOptions"
          :key="item || 'all-refund'"
          type="button"
          :class="{ active: staffFilters.refundInfo === item }"
          @click="selectStaffFilter('refundInfo', item)"
        >
          {{ filterLabel(item, "全部") }}
        </button>
      </div>
      <div v-else-if="staffTab === 'mine'" class="staff-filter-strip" aria-label="按处理进度筛选">
        <button
          v-for="item in mineFilterOptions"
          :key="item || 'all-status'"
          type="button"
          :class="{ active: staffFilters.processStatus === item }"
          @click="selectStaffFilter('processStatus', item)"
        >
          {{ filterLabel(item, "全部") }}
        </button>
      </div>
      <div v-else class="staff-filter-strip readonly">
        <span>已完结工单</span>
      </div>
      <button class="staff-refresh-btn" @click="loadStaffOrders">刷新</button>
    </section>

    <section class="staff-card-list">
      <article v-for="(order, index) in pagedStaffOrders" :key="order.id" class="staff-order-card">
        <div class="staff-card-top">
          <button type="button" class="staff-copy-order" @click="copy(order.orderNumber)">
            {{ order.orderNumber }}
          </button>
          <div class="staff-card-actions">
            <span>{{ order.processStatus }}</span>
            <button
              v-if="staffTab === 'mine'"
              type="button"
              class="staff-collapse-btn"
              :class="{ open: isStaffOrderExpanded(order, index) }"
              :aria-label="isStaffOrderExpanded(order, index) ? '收拢工单' : '展开工单'"
              @click="toggleStaffOrder(order, index)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
          </div>
        </div>
        <div class="staff-card-meta">{{ order.receivedAt }} / {{ order.refundInfo }}</div>
        <div v-if="staffTab === 'history'" class="staff-card-meta">
          佣金：{{ order.commissionAmount ?? 3 }} 元 / {{ order.wageStatus || "工资待结" }}
        </div>

        <template v-if="isStaffOrderExpanded(order, index)">
          <div class="staff-phone-row">
            <button v-for="phone in order.phones" :key="phone" type="button" :aria-label="`复制手机号 ${phone}`" @click="copy(phone)">
              <span>{{ phone }}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h5A1.5 1.5 0 0 1 13 5.5v5A1.5 1.5 0 0 1 11.5 12h-5A1.5 1.5 0 0 1 5 10.5v-5Z" />
                <path d="M3 9.5v-5A1.5 1.5 0 0 1 4.5 3h5" />
              </svg>
            </button>
          </div>

          <div v-if="staffTab === 'claimable'" class="claim-preview">
            <div><span>售后信息</span><b>{{ order.refundInfo || "-" }}</b></div>
            <div><span>退货原因</span><b>{{ order.returnReason || "未填写" }}</b></div>
            <div><span>是否寄出</span><b>{{ order.shipped || "未填写" }}</b></div>
            <div><span>退货地址</span><b>{{ order.returnAddress || "未填写" }}</b></div>
            <button class="staff-primary-btn" @click="claimOrder(order)">领取这个工单</button>
          </div>

          <div v-else-if="staffTab === 'history'" class="claim-preview staff-readonly-info">
            <div><span>售后信息</span><b>{{ order.refundInfo || "-" }}</b></div>
            <div><span>佣金</span><b>{{ order.commissionAmount ?? 3 }} 元</b></div>
            <div><span>工资状态</span><b>{{ order.wageStatus || "工资待结" }}</b></div>
            <div><span>完结时间</span><b>{{ formatDiscussionTime(order.completedAt) || "-" }}</b></div>
          </div>

          <div v-else class="staff-order-form">
            <div class="claim-preview staff-readonly-info">
              <div><span>退货原因</span><b>{{ order.returnReason || "未填写" }}</b></div>
              <div><span>是否寄出</span><b>{{ order.shipped || "未填写" }}</b></div>
              <div><span>退货单号</span><b>{{ order.returnTrackingNo || "未填写" }}</b></div>
              <div><span>退货地址</span><b>{{ order.returnAddress || "未填写" }}</b></div>
            </div>
            <div class="staff-form-grid">
              <label>处理状态
                <select v-model="order.processStatus">
                  <option v-for="item in PROCESS_OPTIONS" :key="item" :value="item">{{ item }}</option>
                </select>
              </label>
            </div>
            <label>已有备注
              <pre class="staff-remark-log">{{ order.internalRemark || "暂无备注" }}</pre>
            </label>
            <label>追加备注<textarea v-model="staffRemarkDrafts[order.id]" rows="2" placeholder="填写后会追加到已有备注后面" /></label>
            <div class="discussion-box staff-discussion-box">
              <strong>工单对话</strong>
              <div class="discussion-list">
                <div v-for="item in order.discussion" :key="item.id" class="discussion-item" :class="item.authorType">
                  <div>
                    <strong>{{ item.authorName }}</strong>
                    <span>{{ formatDiscussionTime(item.createdAt) }}</span>
                  </div>
                  <p>{{ item.content }}</p>
                </div>
                <span v-if="!(order.discussion || []).length" class="discussion-empty">暂无对话</span>
              </div>
              <textarea v-model="staffDiscussionDrafts[order.id]" rows="2" placeholder="给后台留言" />
              <button type="button" class="staff-ghost-btn" @click="submitStaffDiscussion(order)">发送留言</button>
            </div>
            <div class="staff-shot-grid">
              <div>
                <span>收款截图</span>
                <div class="inline-shots">
                  <a v-for="url in order.paymentScreenshots" :key="url" href="#" @click.prevent="openPreview(url)">
                    <img :src="url" alt="收款截图" />
                    <button @click.prevent.stop="removeStaffScreenshot(order, 'paymentScreenshots', url)">移除</button>
                  </a>
                  <label class="staff-upload-btn">
                    上传
                    <input type="file" accept="image/*" @change="event => handleStaffFileChange(event, order, 'paymentScreenshots')" />
                  </label>
                </div>
              </div>
              <div>
                <span>其他截图</span>
                <div class="inline-shots">
                  <a v-for="url in order.otherScreenshots" :key="url" href="#" @click.prevent="openPreview(url)">
                    <img :src="url" alt="其他截图" />
                  </a>
                  <em v-if="!(order.otherScreenshots || []).length" class="staff-shot-empty">暂无其他截图</em>
                </div>
              </div>
            </div>
          </div>
          <button v-if="staffTab === 'mine'" class="staff-primary-btn" @click="saveStaffOrder(order)">保存工单</button>
        </template>
      </article>
      <div v-if="visibleStaffOrders.length === 0" class="empty-state">
        {{ staffTab === "claimable" ? "暂无可领取工单" : staffTab === "history" ? "暂无处理过的订单" : "暂无我的工单，请先到可领取工单里领取" }}
      </div>
      <div v-if="visibleStaffOrders.length > staffPager.pageSize" class="staff-pager">
        <button :disabled="staffPager.current === 1" @click="staffPager.current -= 1">上一页</button>
        <span>{{ staffPager.current }} / {{ Math.ceil(visibleStaffOrders.length / staffPager.pageSize) }}</span>
        <button
          :disabled="staffPager.current >= Math.ceil(visibleStaffOrders.length / staffPager.pageSize)"
          @click="staffPager.current += 1"
        >
          下一页
        </button>
      </div>
    </section>

    <button v-if="previewImage" type="button" class="staff-image-preview" @click="closePreview">
      <img :src="previewImage" alt="截图预览" />
      <span>点击关闭</span>
    </button>
  </main>

  <div v-if="toast.show" class="staff-toast" :class="toast.type">{{ toast.text }}</div>
</template>
