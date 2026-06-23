# 售后订单自助处理平台

独立的售后工单系统，包含后台管理端和员工处理端。

## 路由

- 后台：`/#/admin`
- 员工端：`/#/staff`

## 本地启动

```bash
npm install
npm run dev
```

也可以分开启动：

```bash
npm run server
npm run web
```

## 环境变量

复制 `.env.example` 为 `.env`，填写三方接口 Cookie 和 COS 配置。

```bash
cp .env.example .env
```

关键配置：

- `ADMIN_USER` / `ADMIN_PASSWORD`：后台登录账号密码
- `THIRD_PARTY_COOKIE`：三方订单接口 Cookie
- `SecretId` / `SecretKey`：腾讯云 COS 上传密钥
- `COS_BUCKET` / `COS_REGION`：COS 存储桶和地域

## 提交忽略

以下内容不会提交到 Git：

- `node_modules/`：依赖目录
- `dist/`：构建产物
- `.env` / `.env.*`：真实环境变量和密钥
- `data/`：本地订单、员工账号、登录会话、上传缓存等运行数据
- `*.log`、`.DS_Store` 等本地临时文件

## 常用脚本

```bash
npm run build
npm run test:parser
npm run sync:orders
```
