<script setup>
import { computed, reactive, ref } from "vue";
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
const loggedIn = ref(Boolean(localStorage.getItem("adminToken")));
const activeTab = ref("orders");
const filters = reactive({ keyword: "", processStatus: "" });
const pager = reactive({ current: 1, pageSize: 10 });
const staffList = ref([]);
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
      [order.orderNumber, order.shopName, order.maskedShopName, ...(order.phones || [])]
        .filter(Boolean)
        .some((value) => String(value).includes(keyword));
    return statusOk && keywordOk;
  });
});

const pagedOrders = computed(() => {
  const start = (pager.current - 1) * pager.pageSize;
  return filteredOrders.value.slice(start, start + pager.pageSize);
});

const columns = [
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
  { title: "操作", key: "action", width: 180, fixed: "right" }
];

const staffColumns = [
  { title: "账号", dataIndex: "account", key: "account" },
  { title: "姓名", dataIndex: "name", key: "name" },
  { title: "创建时间", dataIndex: "createdAt", key: "createdAt" }
];

async function doLogin() {
  try {
    const data = await request("/api/login", {
      method: "POST",
      body: JSON.stringify(login)
    });
    localStorage.setItem("adminToken", data.token);
    loggedIn.value = true;
    await loadOrders();
    antMessage.success("登录成功");
  } catch (err) {
    antMessage.error(err.message);
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
  filters.processStatus = "";
  pager.current = 1;
}

loadOrders();
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
        <button :class="{ active: activeTab === 'orders' }" @click="activeTab = 'orders'">订单台账</button>
        <button :class="{ active: activeTab === 'staff' }" @click="activeTab = 'staff'; loadStaffList()">员工管理</button>
      </nav>
      <Space>
        <Button :loading="tableLoading" @click="loadOrders">刷新</Button>
        <Button @click="logout">
          <template #icon><LogoutOutlined /></template>
          退出
        </Button>
      </Space>
    </header>

    <section class="page-title">
      <div>
        <h1>{{ activeTab === "orders" ? "订单补充台账" : "员工管理" }}</h1>
        <span>{{ activeTab === "orders" ? "三方接口同步，订单重复不覆盖" : "添加员工账号，供移动端领取工单使用" }}</span>
      </div>
    </section>

    <section v-if="activeTab === 'orders'" class="admin-content">
      <Row :gutter="16" class="stats-row">
        <Col :span="6"><Card><Statistic title="总工单" :value="stats.total" /></Card></Col>
        <Col :span="6"><Card><Statistic title="未处理" :value="stats.pending" /></Card></Col>
        <Col :span="6"><Card><Statistic title="跟进中" :value="stats.contacting" /></Card></Col>
        <Col :span="6"><Card><Statistic title="已回款" :value="stats.paid" /></Card></Col>
      </Row>

      <Card class="sync-card" title="手动同步">
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
          :scroll="{ x: 1760 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'order'">
              <div class="order-block">
                <Button type="link" class="copy-order" @click="copy(record.orderNumber)">
                  {{ record.orderNumber }}
                </Button>
                <span>{{ record.receivedAt }}</span>
                <span>{{ record.shopName }}</span>
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
              <Select v-model:value="record.shipped" allow-clear placeholder="选择" style="width: 100%">
                <Select.Option v-for="item in SHIPPED_OPTIONS" :key="item" :value="item">{{ item }}</Select.Option>
              </Select>
            </template>

            <template v-else-if="column.key === 'returnTrackingNo'">
              <Input v-model:value="record.returnTrackingNo" placeholder="退货单号" />
            </template>

            <template v-else-if="column.key === 'returnAddress'">
              <Select v-model:value="record.returnAddress" allow-clear placeholder="选择" style="width: 100%">
                <Select.Option v-for="item in ADDRESS_OPTIONS" :key="item" :value="item">{{ item }}</Select.Option>
              </Select>
            </template>

            <template v-else-if="column.key === 'process'">
              <Space direction="vertical" size="small" style="width: 100%">
                <Select v-model:value="record.processStatus" style="width: 100%">
                  <Select.Option v-for="item in PROCESS_OPTIONS" :key="item" :value="item">{{ item }}</Select.Option>
                </Select>
                <Input v-model:value="record.handler" placeholder="处理人" />
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

            <template v-else-if="column.key === 'action'">
              <Space direction="vertical" size="small">
                <Button type="primary" size="small" @click="saveOrder(record)">保存</Button>
                <Button size="small" @click="openAnnotateModal(record)">标注</Button>
                <Button danger size="small" @click="completeUpstream(record)">已完结</Button>
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
        <Table class="desktop-admin-table" :columns="staffColumns" :data-source="staffList" row-key="id" :pagination="{ pageSize: 10 }" bordered />
      </Card>
    </section>
  </main>

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
