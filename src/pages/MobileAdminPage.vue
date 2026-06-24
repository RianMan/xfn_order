<script setup>
import { computed, reactive, ref } from "vue";
import { ADDRESS_OPTIONS, PROCESS_OPTIONS, SHIPPED_OPTIONS, SYNC_STOP_TEXT } from "../constants.js";

const login = reactive({ username: "xiaofuniya", password: "abcd1234" });
const staffForm = reactive({ account: "", name: "", password: "" });
const importParams = reactive({
  p: "1",
  fenyei: "10",
  suoshudianpu: "全部店铺",
  shangchuan: "已上传",
  dangshizhuangtai: "全部类型",
  chulizhuangtai: "0"
});

const loggedIn = ref(Boolean(localStorage.getItem("adminToken")));
const activeTab = ref("orders");
const orders = ref([]);
const staffList = ref([]);
const loading = ref(false);
const tableLoading = ref(false);
const notice = ref("");
const filters = reactive({ keyword: "", processStatus: "" });
const pager = reactive({ current: 1, pageSize: 8 });
const expandedOrders = reactive({});
const annotateModal = reactive({
  open: false,
  loading: false,
  order: null,
  note: ""
});

function authHeaders() {
  const token = localStorage.getItem("adminToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function showNotice(text) {
  notice.value = text;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    notice.value = "";
  }, 2200);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
      ...(options.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem("adminToken");
    loggedIn.value = false;
    orders.value = [];
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
    localStorage.removeItem("adminToken");
    loggedIn.value = false;
    orders.value = [];
    throw new Error(data.message || "登录已过期，请重新登录");
  }
  if (!response.ok) throw new Error(data.message || "截图上传失败");
  return data;
}

const stats = computed(() => ({
  total: orders.value.length,
  pending: orders.value.filter((item) => item.processStatus === "未处理").length,
  contacting: orders.value.filter((item) => ["联系中", "加好友中", "加不到拍手"].includes(item.processStatus)).length,
  paid: orders.value.filter((item) => item.processStatus === "已回款").length
}));

const filteredOrders = computed(() => {
  const keyword = filters.keyword.trim();
  return orders.value.filter((order) => {
    const statusOk = !filters.processStatus || order.processStatus === filters.processStatus;
    const keywordOk =
      !keyword ||
      [order.orderNumber, order.shopName, order.maskedShopName, order.refundInfo, ...(order.phones || [])]
        .filter(Boolean)
        .some((value) => String(value).includes(keyword));
    return statusOk && keywordOk;
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredOrders.value.length / pager.pageSize)));

const pagedOrders = computed(() => {
  if (pager.current > totalPages.value) pager.current = totalPages.value;
  const start = (pager.current - 1) * pager.pageSize;
  return filteredOrders.value.slice(start, start + pager.pageSize);
});

async function doLogin() {
  try {
    const data = await request("/api/login", {
      method: "POST",
      body: JSON.stringify(login)
    });
    localStorage.setItem("adminToken", data.token);
    loggedIn.value = true;
    showNotice("登录成功");
    await loadOrders();
  } catch (err) {
    showNotice(err.message);
  }
}

function logout() {
  localStorage.removeItem("adminToken");
  loggedIn.value = false;
  orders.value = [];
}

async function loadOrders() {
  if (!loggedIn.value) return;
  tableLoading.value = true;
  try {
    const data = await request("/api/admin/orders");
    orders.value = data.orders || [];
  } catch (err) {
    showNotice(err.message);
  } finally {
    tableLoading.value = false;
  }
}

async function loadStaffList() {
  if (!loggedIn.value) return;
  try {
    const data = await request("/api/admin/staff");
    staffList.value = data.staff || [];
  } catch (err) {
    showNotice(err.message);
  }
}

async function switchTab(tab) {
  activeTab.value = tab;
  if (tab === "staff") await loadStaffList();
}

async function createStaffAccount() {
  try {
    await request("/api/admin/staff", {
      method: "POST",
      body: JSON.stringify(staffForm)
    });
    staffForm.account = "";
    staffForm.name = "";
    staffForm.password = "";
    showNotice("员工已添加");
    await loadStaffList();
  } catch (err) {
    showNotice(err.message);
  }
}

async function syncOrders() {
  loading.value = true;
  try {
    const data = await request("/api/admin/import", {
      method: "POST",
      body: JSON.stringify(importParams)
    });
    showNotice(
      `翻页 ${data.pages?.length || 0} 页，${SYNC_STOP_TEXT[data.stoppedReason] || "同步完成"}，新增 ${data.created}`
    );
    await loadOrders();
  } catch (err) {
    showNotice(err.message);
  } finally {
    loading.value = false;
  }
}

async function saveOrder(record) {
  if (!record) return;
  try {
    const data = await request(`/api/admin/orders/${record.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        returnReason: record.returnReason,
        shipped: record.shipped,
        returnTrackingNo: record.returnTrackingNo,
        returnAddress: record.returnAddress,
        processStatus: record.processStatus,
        handler: record.handler,
        internalRemark: record.internalRemark,
        paymentScreenshots: record.paymentScreenshots || [],
        otherScreenshots: record.otherScreenshots || []
      })
    });
    const index = orders.value.findIndex((item) => item.id === data.order.id);
    if (index >= 0) orders.value[index] = data.order;
    showNotice("保存成功");
  } catch (err) {
    showNotice(err.message || "保存失败");
  }
}

async function uploadScreenshot(record, field, file) {
  try {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/admin/upload", {
      method: "POST",
      headers: authHeaders(),
      body: form
    });
    const data = await readUploadResponse(response);
    if (!data.url) throw new Error("上传成功但没有返回图片地址");

    record[field] = [...(record[field] || []), data.url];
    await saveOrder(record);
    showNotice("截图已上传");
  } catch (err) {
    showNotice(err.message || "截图上传失败");
  }
}

async function handleNativeUpload(event, record, field) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (file) await uploadScreenshot(record, field, file);
}

async function removeScreenshot(record, field, url) {
  record[field] = (record[field] || []).filter((item) => item !== url);
  await saveOrder(record);
}

function openAnnotateModal(record) {
  annotateModal.order = record;
  annotateModal.note = "";
  annotateModal.open = true;
}

function closeAnnotateModal() {
  annotateModal.open = false;
  annotateModal.order = null;
  annotateModal.note = "";
}

async function submitAnnotate() {
  const note = annotateModal.note.trim();
  if (!annotateModal.order || !note) {
    showNotice("请输入标注内容");
    return;
  }

  annotateModal.loading = true;
  try {
    await request(`/api/admin/orders/${annotateModal.order.id}/upstream-note`, {
      method: "POST",
      body: JSON.stringify({ note })
    });
    closeAnnotateModal();
    showNotice("已标注到上游");
  } catch (err) {
    showNotice(err.message || "标注失败");
  } finally {
    annotateModal.loading = false;
  }
}

async function completeUpstream(record) {
  if (!record) return;
  if (!window.confirm(`确认把订单 ${record.orderNumber} 标记为已完结吗？`)) return;

  try {
    const data = await request(`/api/admin/orders/${record.id}/upstream-complete`, {
      method: "POST",
      body: "{}"
    });
    const index = orders.value.findIndex((item) => item.id === data.order?.id);
    if (index >= 0) orders.value[index] = data.order;
    showNotice(`已完结并同步，新增 ${data.sync?.created ?? 0} 条`);
    await loadOrders();
  } catch (err) {
    showNotice(err.message || "完结失败");
  }
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
      .then(() => showNotice("已复制"))
      .catch(() => {
        if (fallbackCopy()) showNotice("已复制");
        else showNotice("复制失败，请手动复制");
      });
    return;
  }

  if (fallbackCopy()) showNotice("已复制");
  else showNotice("复制失败，请手动复制");
}

function resetFilters() {
  filters.keyword = "";
  filters.processStatus = "";
  pager.current = 1;
}

function isExpanded(order, index) {
  if (Object.prototype.hasOwnProperty.call(expandedOrders, order.id)) return expandedOrders[order.id];
  return index === 0;
}

function toggleOrder(order, index) {
  expandedOrders[order.id] = !isExpanded(order, index);
}

function pagePrev() {
  pager.current = Math.max(1, pager.current - 1);
}

function pageNext() {
  pager.current = Math.min(totalPages.value, pager.current + 1);
}

loadOrders();
</script>

<template>
  <main v-if="!loggedIn" class="mobile-admin-login">
    <section class="mobile-admin-login-card">
      <span>售后工单后台</span>
      <h1>管理员登录</h1>
      <label>账号<input v-model="login.username" autocomplete="username" /></label>
      <label>密码<input v-model="login.password" type="password" autocomplete="current-password" /></label>
      <button type="button" class="mobile-admin-primary" @click="doLogin">进入后台</button>
    </section>
    <div v-if="notice" class="mobile-admin-toast">{{ notice }}</div>
  </main>

  <main v-else class="mobile-admin-page">
    <header class="mobile-admin-header">
      <div>
        <strong>售后后台</strong>
        <span>{{ activeTab === "orders" ? "订单补充和上游处理" : activeTab === "sync" ? "同步三方订单" : "员工账号管理" }}</span>
      </div>
      <button type="button" @click="logout">退出</button>
    </header>

    <nav class="mobile-admin-tabs">
      <button type="button" :class="{ active: activeTab === 'orders' }" @click="switchTab('orders')">工单</button>
      <button type="button" :class="{ active: activeTab === 'sync' }" @click="switchTab('sync')">同步</button>
      <button type="button" :class="{ active: activeTab === 'staff' }" @click="switchTab('staff')">员工</button>
    </nav>

    <section v-if="activeTab === 'orders'" class="mobile-admin-content">
      <div class="mobile-admin-summary">
        <div><span>总工单</span><b>{{ stats.total }}</b></div>
        <div><span>未处理</span><b>{{ stats.pending }}</b></div>
        <div><span>跟进中</span><b>{{ stats.contacting }}</b></div>
        <div><span>已回款</span><b>{{ stats.paid }}</b></div>
      </div>

      <div class="mobile-admin-tools">
        <input v-model="filters.keyword" placeholder="搜索订单号 / 店铺 / 手机号 / 售后信息" @input="pager.current = 1" />
        <select v-model="filters.processStatus" @change="pager.current = 1">
          <option value="">全部处理进度</option>
          <option v-for="item in PROCESS_OPTIONS" :key="item" :value="item">{{ item }}</option>
        </select>
        <button type="button" @click="resetFilters">重置</button>
        <button type="button" @click="loadOrders">{{ tableLoading ? "刷新中" : "刷新" }}</button>
      </div>

      <div class="m-admin-list">
        <article v-for="(record, index) in pagedOrders" :key="record.id" class="m-admin-ticket">
          <div class="m-admin-ticket-head">
            <span class="m-admin-order-main">
              <button type="button" class="m-admin-order-copy" @click="copy(record.orderNumber)">
                {{ record.orderNumber }}
              </button>
              <em>{{ record.receivedAt }} / {{ record.refundInfo || "售后" }}</em>
            </span>
            <span class="m-admin-status" :data-status="record.processStatus">{{ record.processStatus }}</span>
          </div>

          <button type="button" class="m-admin-shop-line" @click="toggleOrder(record, index)">
            <span>{{ record.shopName }}</span>
            <b>{{ isExpanded(record, index) ? "收起" : "展开处理" }}</b>
          </button>

          <div v-if="isExpanded(record, index)" class="m-admin-ticket-body">
            <div class="m-admin-phone-row">
              <button v-for="phone in record.phones" :key="phone" type="button" @click="copy(phone)">
                {{ phone }} 复制
              </button>
            </div>

            <div class="m-admin-info-grid">
              <div><span>上游状态</span><b>{{ record.sourceStatus || "-" }}</b></div>
              <div><span>售后信息</span><b>{{ record.refundInfo || "-" }}</b></div>
              <div><span>申请时间</span><b>{{ record.appliedAt || "-" }}</b></div>
              <div><span>处理时间</span><b>{{ record.handledAt || "-" }}</b></div>
            </div>

            <div class="m-admin-section">
              <strong>退货补充</strong>
              <label>退货原因<textarea v-model="record.returnReason" rows="3" placeholder="填写退货原因" /></label>
              <div class="m-admin-two-col">
                <label>是否寄出
                  <select v-model="record.shipped">
                    <option value="">请选择</option>
                    <option v-for="item in SHIPPED_OPTIONS" :key="item" :value="item">{{ item }}</option>
                  </select>
                </label>
                <label>退货地址
                  <select v-model="record.returnAddress">
                    <option value="">请选择</option>
                    <option v-for="item in ADDRESS_OPTIONS" :key="item" :value="item">{{ item }}</option>
                  </select>
                </label>
              </div>
              <label>退货单号<input v-model="record.returnTrackingNo" placeholder="填写退货单号" /></label>
            </div>

            <div class="m-admin-section">
              <strong>处理进度</strong>
              <div class="m-admin-two-col">
                <label>状态
                  <select v-model="record.processStatus">
                    <option v-for="item in PROCESS_OPTIONS" :key="item" :value="item">{{ item }}</option>
                  </select>
                </label>
                <label>处理人<input v-model="record.handler" placeholder="处理人" /></label>
              </div>
              <label>备注<textarea v-model="record.internalRemark" rows="3" placeholder="填写备注" /></label>
            </div>

            <div class="m-admin-section">
              <strong>截图</strong>
              <div class="m-admin-shot-block">
                <span>收款截图</span>
                <div class="m-admin-shot-list">
                  <a v-for="url in record.paymentScreenshots" :key="url" :href="url" target="_blank">
                    <img :src="url" alt="收款截图" />
                    <button type="button" @click.prevent="removeScreenshot(record, 'paymentScreenshots', url)">移除</button>
                  </a>
                  <label class="m-admin-upload">
                    上传
                    <input type="file" accept="image/*" @change="event => handleNativeUpload(event, record, 'paymentScreenshots')" />
                  </label>
                </div>
              </div>
              <div class="m-admin-shot-block">
                <span>其他截图</span>
                <div class="m-admin-shot-list">
                  <a v-for="url in record.otherScreenshots" :key="url" :href="url" target="_blank">
                    <img :src="url" alt="其他截图" />
                    <button type="button" @click.prevent="removeScreenshot(record, 'otherScreenshots', url)">移除</button>
                  </a>
                  <label class="m-admin-upload">
                    上传
                    <input type="file" accept="image/*" @change="event => handleNativeUpload(event, record, 'otherScreenshots')" />
                  </label>
                </div>
              </div>
            </div>

            <div class="m-admin-action-bar">
              <button type="button" class="primary" @click="saveOrder(record)">保存</button>
              <button type="button" @click="openAnnotateModal(record)">标注</button>
              <button type="button" class="danger" @click="completeUpstream(record)">已完结</button>
            </div>
          </div>
        </article>
        <div v-if="pagedOrders.length === 0" class="empty-state">暂无订单</div>
      </div>

      <div class="mobile-admin-pager">
        <button type="button" :disabled="pager.current <= 1" @click="pagePrev">上一页</button>
        <span>{{ pager.current }} / {{ totalPages }}，共 {{ filteredOrders.length }} 条</span>
        <button type="button" :disabled="pager.current >= totalPages" @click="pageNext">下一页</button>
      </div>
    </section>

    <section v-else-if="activeTab === 'sync'" class="mobile-admin-content">
      <div class="mobile-admin-panel">
        <h2>手动同步</h2>
        <label>页码<input v-model="importParams.p" /></label>
        <label>每页数量<input v-model="importParams.fenyei" /></label>
        <label>店铺<input v-model="importParams.suoshudianpu" /></label>
        <label>上传状态<input v-model="importParams.shangchuan" /></label>
        <label>当前状态<input v-model="importParams.dangshizhuangtai" /></label>
        <label>处理状态<input v-model="importParams.chulizhuangtai" /></label>
        <button type="button" class="mobile-admin-primary" :disabled="loading" @click="syncOrders">
          {{ loading ? "同步中" : "同步三方订单" }}
        </button>
      </div>
    </section>

    <section v-else class="mobile-admin-content">
      <div class="mobile-admin-panel">
        <h2>添加员工</h2>
        <label>账号<input v-model="staffForm.account" placeholder="登录账号" /></label>
        <label>姓名<input v-model="staffForm.name" placeholder="员工姓名" /></label>
        <label>密码<input v-model="staffForm.password" type="password" placeholder="登录密码" /></label>
        <button type="button" class="mobile-admin-primary" @click="createStaffAccount">添加员工</button>
      </div>

      <div class="mobile-admin-staff-list">
        <article v-for="item in staffList" :key="item.id" class="admin-staff-card">
          <strong>{{ item.name }}</strong>
          <span>账号：{{ item.account }}</span>
          <span>创建时间：{{ item.createdAt }}</span>
        </article>
        <div v-if="staffList.length === 0" class="empty-state">暂无员工</div>
      </div>
    </section>

    <div v-if="notice" class="mobile-admin-toast">{{ notice }}</div>

    <div v-if="annotateModal.open" class="mobile-admin-modal">
      <section>
        <h2>标注上游订单</h2>
        <span>订单号：{{ annotateModal.order?.orderNumber || "-" }}</span>
        <textarea v-model="annotateModal.note" rows="5" placeholder="请输入要同步到上游的标注信息" />
        <div>
          <button type="button" @click="closeAnnotateModal">取消</button>
          <button type="button" class="mobile-admin-primary" :disabled="annotateModal.loading" @click="submitAnnotate">
            {{ annotateModal.loading ? "提交中" : "提交标注" }}
          </button>
        </div>
      </section>
    </div>
  </main>
</template>
