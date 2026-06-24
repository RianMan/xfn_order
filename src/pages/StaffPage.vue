<script setup>
import { computed, reactive, ref } from "vue";
import { Button, Card, Form, Input, message as antMessage, Upload } from "ant-design-vue";
import { PROCESS_OPTIONS } from "../constants.js";

const staffLogin = reactive({ account: "", password: "" });
const staffFilters = reactive({ processStatus: "", refundInfo: "" });
const staffTab = ref("claimable");
const staffPager = reactive({ current: 1, pageSize: 8 });
const staffRemarkDrafts = reactive({});
const staffExpandedOrders = reactive({});

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
const previewImage = ref("");

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
    throw new Error(data.message || "登录已过期，请重新登录");
  }
  if (!response.ok) throw new Error(data.message || "截图上传失败");
  return data;
}

const visibleStaffOrders = computed(() => {
  const source = staffTab.value === "claimable" ? claimableOrders.value : staffOrders.value;
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
    antMessage.success("登录成功");
    await loadStaffOrders();
  } catch (err) {
    antMessage.error(err.message);
  }
}

function logoutStaff() {
  localStorage.removeItem("staffToken");
  localStorage.removeItem("staffProfile");
  staffLoggedIn.value = false;
  staff.value = null;
  staffOrders.value = [];
  claimableOrders.value = [];
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
}

async function claimOrder(order) {
  try {
    await staffRequest(`/api/staff/claim/${order.id}`, { method: "POST", body: "{}" });
    antMessage.success("领取成功");
    staffTab.value = "mine";
    await loadStaffOrders();
  } catch (err) {
    antMessage.warning(err.message);
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
  if (!options.silent) antMessage.success("保存成功");
}

async function uploadStaffScreenshot(record, field, file) {
  if (field !== "paymentScreenshots") {
    antMessage.error("员工只能上传收款截图");
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
    antMessage.success("截图已上传");
  } catch (err) {
    antMessage.error(err.message || "截图上传失败");
  }
  return false;
}

async function removeStaffScreenshot(record, field, url) {
  if (field !== "paymentScreenshots") return;
  record[field] = (record[field] || []).filter((item) => item !== url);
  await saveStaffOrder(record, { includeRemark: false, silent: true });
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
      .then(() => antMessage.success("已复制"))
      .catch(() => {
        if (fallbackCopy()) antMessage.success("已复制");
        else antMessage.error("复制失败，请手动复制");
      });
    return;
  }

  if (fallbackCopy()) antMessage.success("已复制");
  else antMessage.error("复制失败，请手动复制");
}

if (staffLoggedIn.value) loadStaffOrders();
</script>

<template>
  <main v-if="!staffLoggedIn" class="login-screen staff-login-screen">
    <Card class="login-card" :bordered="false">
      <div class="login-title">
        <span>员工工单系统</span>
        <strong>登录</strong>
      </div>
      <Form layout="vertical" @submit.prevent>
        <Form.Item label="员工账号">
          <Input v-model:value="staffLogin.account" size="large" autocomplete="username" />
        </Form.Item>
        <Form.Item label="密码">
          <Input.Password v-model:value="staffLogin.password" size="large" autocomplete="current-password" />
        </Form.Item>
        <Button type="primary" size="large" block @click="loginStaff">进入工单系统</Button>
      </Form>
    </Card>
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
          @click="staffTab = 'claimable'; staffFilters.processStatus = ''; staffPager.current = 1"
        >
          可领取工单池
        </button>
        <button
          :class="{ active: staffTab === 'mine' }"
          @click="staffTab = 'mine'; staffFilters.refundInfo = ''; staffPager.current = 1"
        >
          我的工单
        </button>
      </div>
      <select
        v-if="staffTab === 'claimable'"
        v-model="staffFilters.refundInfo"
        class="staff-select"
        @change="staffPager.current = 1"
      >
        <option value="">按售后信息筛选</option>
        <option v-for="item in claimableRefundOptions" :key="item" :value="item">{{ item }}</option>
      </select>
      <select
        v-else
        v-model="staffFilters.processStatus"
        class="staff-select"
        @change="staffPager.current = 1; loadStaffOrders()"
      >
        <option value="">按处理进度筛选</option>
        <option v-for="item in PROCESS_OPTIONS" :key="item" :value="item">{{ item }}</option>
      </select>
      <button class="staff-ghost-btn" @click="loadStaffOrders">刷新</button>
    </section>

    <section class="staff-card-list">
      <article v-for="(order, index) in pagedStaffOrders" :key="order.id" class="staff-order-card">
        <div class="staff-card-top">
          <button type="button" class="staff-copy-order" @click="copy(order.orderNumber)">{{ order.orderNumber }} 复制</button>
          <div class="staff-card-actions">
            <span>{{ order.processStatus }}</span>
            <button
              v-if="staffTab === 'mine'"
              type="button"
              class="staff-collapse-btn"
              @click="toggleStaffOrder(order, index)"
            >
              {{ isStaffOrderExpanded(order, index) ? "收拢" : "展开" }}
            </button>
          </div>
        </div>
        <div class="staff-card-meta">{{ order.receivedAt }} / {{ order.refundInfo }}</div>

        <template v-if="isStaffOrderExpanded(order, index)">
          <div class="staff-phone-row">
            <button v-for="phone in order.phones" :key="phone" type="button" @click="copy(phone)">{{ phone }} 复制</button>
          </div>

          <div v-if="staffTab === 'claimable'" class="claim-preview">
            <div><span>售后信息</span><b>{{ order.refundInfo || "-" }}</b></div>
            <div><span>退货原因</span><b>{{ order.returnReason || "未填写" }}</b></div>
            <div><span>是否寄出</span><b>{{ order.shipped || "未填写" }}</b></div>
            <div><span>退货地址</span><b>{{ order.returnAddress || "未填写" }}</b></div>
            <button class="staff-primary-btn" @click="claimOrder(order)">领取这个工单</button>
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
            <div class="staff-shot-grid">
              <div>
                <span>收款截图</span>
                <div class="inline-shots">
                  <a v-for="url in order.paymentScreenshots" :key="url" href="#" @click.prevent="openPreview(url)">
                    <img :src="url" alt="收款截图" />
                    <button @click.prevent.stop="removeStaffScreenshot(order, 'paymentScreenshots', url)">移除</button>
                  </a>
                  <Upload :before-upload="file => uploadStaffScreenshot(order, 'paymentScreenshots', file)" :show-upload-list="false" accept="image/*">
                    <button class="staff-upload-btn">上传</button>
                  </Upload>
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
        {{ staffTab === "claimable" ? "暂无可领取工单" : "暂无我的工单，请先到可领取工单里领取" }}
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
</template>
