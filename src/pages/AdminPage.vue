<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref } from "vue";
import {
  Button,
  Card,
  Col,
  Form,
  Image,
  Input,
  message as antMessage,
  Modal,
  Pagination,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Upload
} from "ant-design-vue";
import { CloudSyncOutlined, LogoutOutlined, UploadOutlined } from "@ant-design/icons-vue";
import { ADDRESS_OPTIONS, PROCESS_OPTIONS, SHIPPED_OPTIONS, SYNC_STOP_TEXT } from "../constants.js";

const { TextArea } = Input;
const WAGE_OPTIONS = ["工资待结", "工资已结"];

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

const orders = ref([]);
const loading = ref(false);
const tableLoading = ref(false);
const dashboardLoading = ref(false);
const loggedIn = ref(Boolean(localStorage.getItem("adminToken")));
const activeTab = ref("orders");
const dashboardData = ref(null);
const trendChartRef = ref(null);
const statusChartRef = ref(null);
const assigneeChartRef = ref(null);
const chartInstances = [];
let echartsApi;
const filters = reactive({
  keyword: "",
  processStatus: undefined,
  assigneeAccount: undefined,
  difficulty: undefined,
  returnAddress: undefined
});
const pager = reactive({ current: 1, pageSize: 10 });
const staffList = ref([]);
const discussionDrafts = reactive({});
const annotateModal = reactive({
  open: false,
  loading: false,
  order: null,
  note: ""
});
const staffEditModal = reactive({
  open: false,
  loading: false,
  id: "",
  account: "",
  name: "",
  password: ""
});

function authHeaders() {
  const token = localStorage.getItem("adminToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
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

const orderScope = computed(() => (activeTab.value === "history" ? "history" : "active"));

const pageMeta = computed(() => {
  if (activeTab.value === "dashboard") {
    return {
      title: "处理进度大盘",
      subtitle: "按天查看售后新增、处理领取、回款完成和员工处理情况"
    };
  }
  if (activeTab.value === "orders") {
    return {
      title: "订单补充台账",
      subtitle: "三方接口同步，订单重复不覆盖"
    };
  }
  if (activeTab.value === "history") {
    return {
      title: "历史订单",
      subtitle: "已完结订单，维护佣金和工资发放状态"
    };
  }
  return {
    title: "员工管理",
    subtitle: "添加员工账号，供移动端领取工单使用"
  };
});

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
    const assigneeOk =
      !filters.assigneeAccount ||
      (filters.assigneeAccount === "__unassigned__"
        ? !order.assigneeAccount
        : order.assigneeAccount === filters.assigneeAccount);
    const difficultyOk =
      !filters.difficulty ||
      (filters.difficulty === "hard" ? Number(order.difficultyLevel || 0) > 0 : Number(order.difficultyLevel || 0) === 0);
    const returnAddressOk = !filters.returnAddress || order.returnAddress === filters.returnAddress;
    const keywordOk =
      !keyword ||
      [order.orderNumber, order.shopName, order.maskedShopName, ...(order.phones || [])]
        .filter(Boolean)
        .some((value) => String(value).includes(keyword));
    return statusOk && assigneeOk && difficultyOk && returnAddressOk && keywordOk;
  });
});

const pagedOrders = computed(() => {
  const start = (pager.current - 1) * pager.pageSize;
  return filteredOrders.value.slice(start, start + pager.pageSize);
});

const baseColumns = [
  { title: "订单信息", key: "order", width: 280, fixed: "left" },
  { title: "售后信息", key: "afterSales", width: 140 },
  { title: "退货原因", key: "returnReason", width: 220 },
  { title: "是否寄出", key: "shipped", width: 120 },
  { title: "退货单号", key: "returnTrackingNo", width: 180 },
  { title: "退货地址", key: "returnAddress", width: 120 },
  { title: "处理", key: "process", width: 220 },
  { title: "备注", key: "remark", width: 220 },
  { title: "收款截图", key: "paymentScreenshots", width: 180 },
  { title: "其他截图", key: "otherScreenshots", width: 180 },
  { title: "工单对话", key: "discussion", width: 280 },
  { title: "操作", key: "action", width: 180, fixed: "right" }
];

const historyColumns = [
  { title: "佣金", key: "commission", width: 120 },
  { title: "工资状态", key: "wageStatus", width: 140 }
];

const columns = computed(() => {
  if (activeTab.value !== "history") return baseColumns;
  const actionIndex = baseColumns.findIndex((item) => item.key === "action");
  return [
    ...baseColumns.slice(0, actionIndex),
    ...historyColumns,
    ...baseColumns.slice(actionIndex)
  ];
});

const staffColumns = [
  { title: "账号", dataIndex: "account", key: "account" },
  { title: "姓名", dataIndex: "name", key: "name" },
  { title: "创建时间", dataIndex: "createdAt", key: "createdAt" },
  { title: "操作", key: "action", width: 120 }
];

async function doLogin() {
  try {
    const data = await request("/api/login", {
      method: "POST",
      body: JSON.stringify(login)
    });
    localStorage.setItem("adminToken", data.token);
    loggedIn.value = true;
    await loadDashboard();
    antMessage.success("登录成功");
  } catch (err) {
    antMessage.error(err.message);
  }
}

function logout() {
  localStorage.removeItem("adminToken");
  loggedIn.value = false;
  orders.value = [];
  dashboardData.value = null;
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function disposeCharts() {
  while (chartInstances.length) {
    chartInstances.pop()?.dispose();
  }
}

function mountChart(el, option) {
  if (!el) return;
  const chart = echarts.init(el);
  chart.setOption(option);
  chartInstances.push(chart);
}

function resizeCharts() {
  for (const chart of chartInstances) chart.resize();
}

async function loadEcharts() {
  if (!echartsApi) echartsApi = await import("echarts");
  return echartsApi;
}

async function renderDashboardCharts() {
  disposeCharts();
  const data = dashboardData.value;
  if (!data) return;
  const echarts = await loadEcharts();

  const dates = data.trend.map((item) => item.date.slice(5));
  mountChart(trendChartRef.value, {
    color: ["#1677ff", "#13c2c2", "#52c41a", "#faad14"],
    tooltip: { trigger: "axis" },
    legend: { top: 0, data: ["新增订单", "领取处理", "已回款", "回款金额"] },
    grid: { left: 42, right: 44, top: 48, bottom: 28 },
    xAxis: { type: "category", boundaryGap: false, data: dates },
    yAxis: [
      { type: "value", minInterval: 1 },
      { type: "value", minInterval: 1, axisLabel: { formatter: "{value}元" } }
    ],
    series: [
      { name: "新增订单", type: "line", smooth: true, data: data.trend.map((item) => item.newOrders) },
      { name: "领取处理", type: "line", smooth: true, data: data.trend.map((item) => item.claimedOrders) },
      { name: "已回款", type: "bar", data: data.trend.map((item) => item.paidOrders) },
      { name: "回款金额", type: "line", smooth: true, yAxisIndex: 1, data: data.trend.map((item) => Number(item.paymentAmount || 0).toFixed(2)) }
    ]
  });

  mountChart(statusChartRef.value, {
    color: ["#1677ff", "#52c41a", "#faad14", "#ff7875", "#722ed1", "#13c2c2"],
    tooltip: { trigger: "item" },
    legend: { bottom: 0, type: "scroll" },
    series: [{
      name: "处理状态",
      type: "pie",
      radius: ["48%", "70%"],
      center: ["50%", "44%"],
      avoidLabelOverlap: true,
      label: { formatter: "{b}\n{c}单" },
      data: data.statusDistribution
    }]
  });

  mountChart(assigneeChartRef.value, {
    color: ["#52c41a", "#1677ff", "#faad14"],
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0, data: ["已回款", "领取量", "处理中"] },
    grid: { left: 42, right: 20, top: 42, bottom: 28 },
    xAxis: { type: "category", data: data.assigneeRanking.map((item) => item.name) },
    yAxis: { type: "value", minInterval: 1 },
    series: [
      { name: "已回款", type: "bar", data: data.assigneeRanking.map((item) => item.paid) },
      { name: "领取量", type: "bar", data: data.assigneeRanking.map((item) => item.claimed) },
      { name: "处理中", type: "bar", data: data.assigneeRanking.map((item) => item.active) }
    ]
  });
}

async function loadDashboard() {
  if (!loggedIn.value) return;
  dashboardLoading.value = true;
  try {
    dashboardData.value = await request("/api/admin/dashboard?days=14");
    dashboardLoading.value = false;
    await nextTick();
    renderDashboardCharts();
  } catch (err) {
    antMessage.error(err.message || "大盘加载失败");
  } finally {
    dashboardLoading.value = false;
  }
}

async function switchTab(tab) {
  activeTab.value = tab;
  if (tab === "dashboard") {
    await loadDashboard();
    return;
  }
  if (tab === "staff") {
    await loadStaffList();
    return;
  }
  pager.current = 1;
  await loadOrders();
}

async function loadOrders() {
  if (!loggedIn.value) return;
  tableLoading.value = true;
  try {
    if (!staffList.value.length) await loadStaffList();
    const data = await request(`/api/admin/orders?scope=${orderScope.value}`);
    orders.value = data.orders;
  } catch (err) {
    antMessage.error(err.message);
  } finally {
    tableLoading.value = false;
  }
}

async function loadStaffList() {
  if (!loggedIn.value) return;
  const data = await request("/api/admin/staff");
  staffList.value = data.staff;
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
    antMessage.success("员工已添加");
    await loadStaffList();
  } catch (err) {
    antMessage.error(err.message);
  }
}

function openStaffEditModal(record) {
  staffEditModal.id = record.id;
  staffEditModal.account = record.account;
  staffEditModal.name = record.name;
  staffEditModal.password = "";
  staffEditModal.open = true;
}

async function submitStaffEdit() {
  if (!staffEditModal.id) return;
  staffEditModal.loading = true;
  try {
    const data = await request(`/api/admin/staff/${staffEditModal.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        account: staffEditModal.account,
        name: staffEditModal.name,
        password: staffEditModal.password
      })
    });
    const index = staffList.value.findIndex((item) => item.id === data.staff.id);
    if (index >= 0) staffList.value[index] = data.staff;
    staffEditModal.open = false;
    antMessage.success("员工已更新");
  } catch (err) {
    antMessage.error(err.message || "更新失败");
  } finally {
    staffEditModal.loading = false;
  }
}

async function syncOrders() {
  loading.value = true;
  try {
    const data = await request("/api/admin/import", {
      method: "POST",
      body: JSON.stringify(importParams)
    });
    antMessage.success(
      `翻页 ${data.pages?.length || 0} 页，${SYNC_STOP_TEXT[data.stoppedReason] || "同步完成"}；新增 ${data.created}，重复跳过 ${data.skippedDuplicate}，旧数据跳过 ${data.skippedOld}`
    );
    await loadOrders();
  } catch (err) {
    antMessage.error(err.message);
  } finally {
    loading.value = false;
  }
}

function openAnnotateModal(record) {
  annotateModal.order = record;
  annotateModal.note = "";
  annotateModal.open = true;
}

async function submitAnnotate() {
  const note = annotateModal.note.trim();
  if (!annotateModal.order || !note) {
    antMessage.warning("请输入标注内容");
    return;
  }

  annotateModal.loading = true;
  try {
    await request(`/api/admin/orders/${annotateModal.order.id}/upstream-note`, {
      method: "POST",
      body: JSON.stringify({ note })
    });
    annotateModal.open = false;
    annotateModal.order = null;
    annotateModal.note = "";
    antMessage.success("已标注到上游");
  } catch (err) {
    antMessage.error(err.message || "标注失败");
  } finally {
    annotateModal.loading = false;
  }
}

async function completeUpstream(record) {
  if (!record) return;
  const confirmed = window.confirm(`确认把订单 ${record.orderNumber} 标记为已完结吗？`);
  if (!confirmed) return;

  try {
    const data = await request(`/api/admin/orders/${record.id}/upstream-complete`, {
      method: "POST",
      body: "{}"
    });
    const index = orders.value.findIndex((item) => item.id === data.order?.id);
    if (index >= 0) orders.value[index] = data.order;
    antMessage.success(`已完结并同步远程数据，新增 ${data.sync?.created ?? 0} 条`);
    await loadOrders();
  } catch (err) {
    antMessage.error(err.message || "完结失败");
  }
}

function updateAssignee(record, account) {
  const cleanAccount = account || "";
  const staff = staffList.value.find((item) => item.account === cleanAccount);
  record.assigneeAccount = cleanAccount;
  record.assigneeName = staff?.name || "";
  record.handler = staff?.name || "";
  record.claimedAt = cleanAccount ? (record.claimedAt || new Date().toISOString()) : "";
}

function updateOptionalField(record, field, value) {
  record[field] = value || "";
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
        assigneeAccount: record.assigneeAccount || "",
        assigneeName: record.assigneeName || "",
        claimedAt: record.claimedAt || "",
        internalRemark: record.internalRemark,
        paymentScreenshots: record.paymentScreenshots || [],
        otherScreenshots: record.otherScreenshots || [],
        commissionAmount: record.commissionAmount,
        wageStatus: record.wageStatus
      })
    });

    const index = orders.value.findIndex((item) => item.id === data.order.id);
    if (index >= 0) orders.value[index] = data.order;
    antMessage.success("保存成功");
  } catch (err) {
    antMessage.error(err.message || "保存失败");
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
    antMessage.success("截图已上传");
  } catch (err) {
    antMessage.error(err.message || "截图上传失败");
  }
  return false;
}

async function removeScreenshot(record, field, url) {
  record[field] = (record[field] || []).filter((item) => item !== url);
  await saveOrder(record);
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

async function submitDiscussion(record) {
  const content = String(discussionDrafts[record.id] || "").trim();
  if (!content) {
    antMessage.warning("请输入回复内容");
    return;
  }

  try {
    const data = await request(`/api/admin/orders/${record.id}/discussion`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
    const index = orders.value.findIndex((item) => item.id === data.order.id);
    if (index >= 0) orders.value[index] = data.order;
    discussionDrafts[record.id] = "";
    antMessage.success("已回复");
  } catch (err) {
    antMessage.error(err.message || "回复失败");
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

function resetFilters() {
  filters.keyword = "";
  filters.processStatus = undefined;
  filters.assigneeAccount = undefined;
  filters.difficulty = undefined;
  filters.returnAddress = undefined;
  pager.current = 1;
}

loadOrders();
if (activeTab.value === "dashboard") loadDashboard();
window.addEventListener("resize", resizeCharts);
onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeCharts);
  disposeCharts();
});
</script>

<template>
  <main v-if="!loggedIn" class="login-screen">
    <Card class="login-card" :bordered="false">
      <div class="login-title">
        <span>售后工单后台</span>
        <strong>登录</strong>
      </div>
      <Form layout="vertical" @submit.prevent>
        <Form.Item label="账号">
          <Input v-model:value="login.username" size="large" autocomplete="username" />
        </Form.Item>
        <Form.Item label="密码">
          <Input.Password v-model:value="login.password" size="large" autocomplete="current-password" />
        </Form.Item>
        <Button type="primary" size="large" block @click="doLogin">进入后台</Button>
      </Form>
    </Card>
  </main>

  <main v-else class="admin-page">
    <header class="top-nav">
      <div class="brand">
        <strong>售后工单</strong>
        <span>After-sales</span>
      </div>
      <nav class="top-menu">
        <button :class="{ active: activeTab === 'orders' }" @click="switchTab('orders')">订单台账</button>
        <button :class="{ active: activeTab === 'dashboard' }" @click="switchTab('dashboard')">数据大盘</button>
        <button :class="{ active: activeTab === 'history' }" @click="switchTab('history')">历史订单</button>
        <button :class="{ active: activeTab === 'staff' }" @click="switchTab('staff')">员工管理</button>
      </nav>
      <Space>
        <Button :loading="activeTab === 'dashboard' ? dashboardLoading : tableLoading" @click="activeTab === 'dashboard' ? loadDashboard() : loadOrders()">刷新</Button>
        <Button @click="logout">
          <template #icon><LogoutOutlined /></template>
          退出
        </Button>
      </Space>
    </header>

    <section class="page-title">
      <div>
        <h1>{{ pageMeta.title }}</h1>
        <span>{{ pageMeta.subtitle }}</span>
      </div>
    </section>

    <section v-if="activeTab === 'dashboard'" class="admin-content dashboard-content">
      <Row :gutter="16" class="stats-row">
        <Col :span="6">
          <Card :loading="dashboardLoading">
            <Statistic title="今日新增售后" :value="dashboardData?.summary?.todayNew || 0" suffix="单" />
          </Card>
        </Col>
        <Col :span="6">
          <Card :loading="dashboardLoading">
            <Statistic title="今日已回款" :value="dashboardData?.summary?.todayPaid || 0" suffix="单" />
          </Card>
        </Col>
        <Col :span="6">
          <Card :loading="dashboardLoading">
            <Statistic title="今日回款金额" :value="formatMoney(dashboardData?.summary?.todayPaymentAmount)" prefix="¥" />
          </Card>
        </Col>
        <Col :span="6">
          <Card :loading="dashboardLoading">
            <Statistic title="公共池待领" :value="dashboardData?.summary?.unassigned || 0" suffix="单" />
          </Card>
        </Col>
      </Row>

      <Row :gutter="16" class="stats-row">
        <Col :span="6">
          <Card :loading="dashboardLoading">
            <Statistic title="全部售后订单" :value="dashboardData?.summary?.total || 0" suffix="单" />
          </Card>
        </Col>
        <Col :span="6">
          <Card :loading="dashboardLoading">
            <Statistic title="进行中订单" :value="dashboardData?.summary?.active || 0" suffix="单" />
          </Card>
        </Col>
        <Col :span="6">
          <Card :loading="dashboardLoading">
            <Statistic title="累计回款订单" :value="dashboardData?.summary?.paid || 0" suffix="单" />
          </Card>
        </Col>
        <Col :span="6">
          <Card :loading="dashboardLoading">
            <Statistic title="累计回款金额" :value="formatMoney(dashboardData?.summary?.paymentAmount)" prefix="¥" />
          </Card>
        </Col>
      </Row>

      <Card class="dashboard-chart-card" title="近 14 天订单处理趋势" :loading="dashboardLoading">
        <div ref="trendChartRef" class="dashboard-chart large"></div>
      </Card>

      <Row :gutter="16">
        <Col :span="10">
          <Card class="dashboard-chart-card" title="当前处理状态分布" :loading="dashboardLoading">
            <div ref="statusChartRef" class="dashboard-chart"></div>
          </Card>
        </Col>
        <Col :span="14">
          <Card class="dashboard-chart-card" title="员工处理排行" :loading="dashboardLoading">
            <div ref="assigneeChartRef" class="dashboard-chart"></div>
          </Card>
        </Col>
      </Row>

      <div class="dashboard-sync-note">
        <span>后台服务已配置北京时间每天 00:00 自动同步上游订单，大盘刷新后会展示最新同步结果。</span>
        <span v-if="dashboardData?.updatedAt">最后统计：{{ formatDiscussionTime(dashboardData.updatedAt) }}</span>
      </div>
    </section>

    <section v-else-if="activeTab === 'orders' || activeTab === 'history'" class="admin-content">
      <Row :gutter="16" class="stats-row">
        <Col :span="6"><Card><Statistic title="总工单" :value="stats.total" /></Card></Col>
        <Col :span="6"><Card><Statistic title="未处理" :value="stats.pending" /></Card></Col>
        <Col :span="6"><Card><Statistic title="跟进中" :value="stats.contacting" /></Card></Col>
        <Col :span="6"><Card><Statistic title="已回款" :value="stats.paid" /></Card></Col>
      </Row>

      <Card v-if="activeTab === 'orders'" class="sync-card" title="手动同步">
        <Row :gutter="12" align="bottom">
          <Col :span="3"><Form.Item label="页码"><Input v-model:value="importParams.p" /></Form.Item></Col>
          <Col :span="3"><Form.Item label="每页"><Input v-model:value="importParams.fenyei" /></Form.Item></Col>
          <Col :span="5"><Form.Item label="店铺"><Input v-model:value="importParams.suoshudianpu" /></Form.Item></Col>
          <Col :span="4"><Form.Item label="上传状态"><Input v-model:value="importParams.shangchuan" /></Form.Item></Col>
          <Col :span="4"><Form.Item label="处理状态"><Input v-model:value="importParams.chulizhuangtai" /></Form.Item></Col>
          <Col :span="5">
            <Button type="primary" :loading="loading" block @click="syncOrders">
              <template #icon><CloudSyncOutlined /></template>
              同步三方订单
            </Button>
          </Col>
        </Row>
      </Card>

      <Card class="table-card">
        <template #title>
          <Space>
            <Input.Search
              v-model:value="filters.keyword"
              allow-clear
              placeholder="搜索订单号 / 店铺 / 手机号"
              style="width: 320px"
              @search="pager.current = 1"
            />
            <Select
              v-model:value="filters.processStatus"
              allow-clear
              placeholder="全部进度"
              style="width: 150px"
              @change="pager.current = 1"
            >
              <Select.Option v-for="item in PROCESS_OPTIONS" :key="item" :value="item">{{ item }}</Select.Option>
            </Select>
            <Select
              v-model:value="filters.assigneeAccount"
              allow-clear
              placeholder="全部处理人"
              style="width: 160px"
              @change="pager.current = 1"
            >
              <Select.Option value="__unassigned__">公共池</Select.Option>
              <Select.Option v-for="staff in staffList" :key="staff.account" :value="staff.account">{{ staff.name }}</Select.Option>
            </Select>
            <Select
              v-model:value="filters.difficulty"
              allow-clear
              placeholder="全部难度"
              style="width: 130px"
              @change="pager.current = 1"
            >
              <Select.Option value="hard">难单</Select.Option>
              <Select.Option value="normal">普通单</Select.Option>
            </Select>
            <Select
              v-model:value="filters.returnAddress"
              allow-clear
              placeholder="全部退回地点"
              style="width: 150px"
              @change="pager.current = 1"
            >
              <Select.Option v-for="item in ADDRESS_OPTIONS" :key="item" :value="item">{{ item }}</Select.Option>
            </Select>
            <Button @click="resetFilters">重置</Button>
          </Space>
        </template>

        <Table
          class="desktop-admin-table"
          :columns="columns"
          :data-source="pagedOrders"
          :loading="tableLoading"
          :pagination="false"
          row-key="id"
          size="middle"
          bordered
          :scroll="{ x: 2040 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'order'">
              <div class="order-block">
                <Button type="link" class="copy-order" @click="copy(record.orderNumber)">
                  {{ record.orderNumber }}
                </Button>
                <span>{{ record.receivedAt }}</span>
                <span>{{ record.shopName }}</span>
                <Tag v-if="record.difficultyLevel" color="red">难度 {{ record.difficultyLevel }}</Tag>
                <div class="phone-tags">
                  <Tag v-for="phone in record.phones" :key="phone" color="blue" @click="copy(phone)">
                    {{ phone }} 复制
                  </Tag>
                </div>
              </div>
            </template>

            <template v-else-if="column.key === 'afterSales'">
              <Space direction="vertical" size="small">
                <Tag color="orange">{{ record.refundInfo || "售后" }}</Tag>
                <span class="muted">{{ record.sourceStatus }}</span>
              </Space>
            </template>

            <template v-else-if="column.key === 'returnReason'">
              <TextArea v-model:value="record.returnReason" :rows="2" placeholder="退货原因" />
            </template>

            <template v-else-if="column.key === 'shipped'">
              <Select
                :value="record.shipped || undefined"
                allow-clear
                placeholder="选择是否寄出"
                style="width: 100%"
                @change="value => updateOptionalField(record, 'shipped', value)"
              >
                <Select.Option v-for="item in SHIPPED_OPTIONS" :key="item" :value="item">{{ item }}</Select.Option>
              </Select>
            </template>

            <template v-else-if="column.key === 'returnTrackingNo'">
              <Input v-model:value="record.returnTrackingNo" placeholder="退货单号" />
            </template>

            <template v-else-if="column.key === 'returnAddress'">
              <Select
                :value="record.returnAddress || undefined"
                allow-clear
                placeholder="选择退货地址"
                style="width: 100%"
                @change="value => updateOptionalField(record, 'returnAddress', value)"
              >
                <Select.Option v-for="item in ADDRESS_OPTIONS" :key="item" :value="item">{{ item }}</Select.Option>
              </Select>
            </template>

            <template v-else-if="column.key === 'process'">
              <Space direction="vertical" size="small" style="width: 100%">
                <Select v-model:value="record.processStatus" style="width: 100%">
                  <Select.Option v-for="item in PROCESS_OPTIONS" :key="item" :value="item">{{ item }}</Select.Option>
                </Select>
                <Select
                  :value="record.assigneeAccount || undefined"
                  allow-clear
                  placeholder="公共池"
                  style="width: 100%"
                  @change="value => updateAssignee(record, value)"
                >
                  <Select.Option v-for="staff in staffList" :key="staff.account" :value="staff.account">{{ staff.name }}</Select.Option>
                </Select>
              </Space>
            </template>

            <template v-else-if="column.key === 'remark'">
              <TextArea v-model:value="record.internalRemark" :rows="2" placeholder="备注" />
            </template>

            <template v-else-if="column.key === 'paymentScreenshots'">
              <div class="inline-shots">
                <div v-for="url in record.paymentScreenshots" :key="url" class="shot-thumb">
                  <Image :src="url" :width="52" :height="52" />
                  <button @click="removeScreenshot(record, 'paymentScreenshots', url)">移除</button>
                </div>
                <Upload :before-upload="file => uploadScreenshot(record, 'paymentScreenshots', file)" :show-upload-list="false" accept="image/*">
                  <Button size="small"><template #icon><UploadOutlined /></template>上传</Button>
                </Upload>
              </div>
            </template>

            <template v-else-if="column.key === 'otherScreenshots'">
              <div class="inline-shots">
                <div v-for="url in record.otherScreenshots" :key="url" class="shot-thumb">
                  <Image :src="url" :width="52" :height="52" />
                  <button @click="removeScreenshot(record, 'otherScreenshots', url)">移除</button>
                </div>
                <Upload :before-upload="file => uploadScreenshot(record, 'otherScreenshots', file)" :show-upload-list="false" accept="image/*">
                  <Button size="small"><template #icon><UploadOutlined /></template>上传</Button>
                </Upload>
              </div>
            </template>

            <template v-else-if="column.key === 'commission'">
              <Input v-model:value="record.commissionAmount" type="number" min="0" step="0.01" placeholder="佣金" />
            </template>

            <template v-else-if="column.key === 'wageStatus'">
              <Select v-model:value="record.wageStatus" style="width: 100%">
                <Select.Option v-for="item in WAGE_OPTIONS" :key="item" :value="item">{{ item }}</Select.Option>
              </Select>
            </template>

            <template v-else-if="column.key === 'discussion'">
              <div class="discussion-box">
                <div class="discussion-list">
                  <div v-for="item in record.discussion" :key="item.id" class="discussion-item" :class="item.authorType">
                    <div>
                      <strong>{{ item.authorName }}</strong>
                      <span>{{ formatDiscussionTime(item.createdAt) }}</span>
                    </div>
                    <p>{{ item.content }}</p>
                  </div>
                  <span v-if="!(record.discussion || []).length" class="discussion-empty">暂无对话</span>
                </div>
                <TextArea v-model:value="discussionDrafts[record.id]" :rows="2" placeholder="回复员工" />
                <Button size="small" @click="submitDiscussion(record)">回复</Button>
              </div>
            </template>

            <template v-else-if="column.key === 'action'">
              <Space direction="vertical" size="small">
                <Button type="primary" size="small" @click="saveOrder(record)">{{ activeTab === "history" ? "保存薪资" : "保存" }}</Button>
                <Button v-if="activeTab !== 'history'" size="small" @click="openAnnotateModal(record)">标注</Button>
                <Button v-if="activeTab !== 'history'" danger size="small" @click="completeUpstream(record)">已完结</Button>
              </Space>
            </template>
          </template>
        </Table>

        <div class="pager">
          <Pagination
            v-model:current="pager.current"
            v-model:page-size="pager.pageSize"
            :total="filteredOrders.length"
            :show-size-changer="true"
            :page-size-options="['10', '20', '50', '100']"
            show-total
          />
        </div>
      </Card>
    </section>

    <section v-else class="admin-content">
      <Card title="添加员工" class="admin-staff-form">
        <Row :gutter="12" align="bottom">
          <Col :span="6"><Form.Item label="账号"><Input v-model:value="staffForm.account" placeholder="登录账号" /></Form.Item></Col>
          <Col :span="6"><Form.Item label="姓名"><Input v-model:value="staffForm.name" placeholder="员工姓名" /></Form.Item></Col>
          <Col :span="6"><Form.Item label="密码"><Input.Password v-model:value="staffForm.password" placeholder="登录密码" /></Form.Item></Col>
          <Col :span="6"><Button type="primary" block @click="createStaffAccount">添加员工</Button></Col>
        </Row>
      </Card>

      <Card class="table-card" title="员工列表">
        <Table class="desktop-admin-table" :columns="staffColumns" :data-source="staffList" row-key="id" :pagination="{ pageSize: 10 }" bordered>
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'action'">
              <Button size="small" @click="openStaffEditModal(record)">编辑</Button>
            </template>
          </template>
        </Table>
      </Card>
    </section>
  </main>

  <Modal
    v-model:open="staffEditModal.open"
    title="编辑员工"
    :confirm-loading="staffEditModal.loading"
    ok-text="保存"
    cancel-text="取消"
    @ok="submitStaffEdit"
  >
    <Space direction="vertical" style="width: 100%">
      <Input v-model:value="staffEditModal.account" placeholder="登录账号" />
      <Input v-model:value="staffEditModal.name" placeholder="员工姓名" />
      <Input.Password v-model:value="staffEditModal.password" placeholder="新密码，留空则不修改" />
    </Space>
  </Modal>

  <Modal
    v-model:open="annotateModal.open"
    title="标注上游订单"
    ok-text="提交标注"
    cancel-text="取消"
    :confirm-loading="annotateModal.loading"
    @ok="submitAnnotate"
  >
    <Space direction="vertical" style="width: 100%">
      <div class="muted">订单号：{{ annotateModal.order?.orderNumber || "-" }}</div>
      <TextArea v-model:value="annotateModal.note" :rows="4" placeholder="请输入要同步到上游的标注信息" />
    </Space>
  </Modal>
</template>
