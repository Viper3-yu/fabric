# 迹信生产部署指南

目标形态：一台 Linux 服务器，Nginx 终止 TLS 并托管前端静态文件，`/api` 反向代理到本机 Go API；API 连接真实 Fabric 网络的 Peer 节点。

## 1. 构建

```bash
# 服务器上需要 Go 1.23+、Node 20.12+、pnpm 11
pnpm install
pnpm build          # 产出 apps/web/dist 与各 Go 二进制

go build -o /opt/jixin/bin/jixin-api ./apps/api/cmd/server
mkdir -p /opt/jixin/web
cp -r apps/web/dist/* /opt/jixin/web/
```

## 2. API 环境变量

`NODE_ENV=production` 时以下配置是硬性要求，缺失即拒绝启动：

- `JWT_SECRET`：≥16 字符随机串（`openssl rand -hex 32`）。
- `APP_PASSWORD_HASH_<账号>`：四个账户（SHIPPER/CARRIER/RECEIVER/AUDITOR）每个都要有
  bcrypt 哈希，用 `go run ./apps/api/cmd/hash-password '密码'` 生成。
- Fabric 连接：`FABRIC_ORG1_*`、`FABRIC_ORG2_*` 指向真实网络的证书/私钥/Peer。
- `CORS_ORIGIN`：同源部署（Nginx 反代）时浏览器请求不带跨域 Origin，可不设；
  若前端与 API 分域，必须显式列出前端 Origin（禁止 `*`）。
- `PUBLIC_RATE_LIMIT_PER_MINUTE`：默认 60。Nginx 层已有 `limit_req` 时可按需调整。
- `TRUST_PROXY=true`：仅在 Nginx 之类可信代理转发 `X-Forwarded-For` 时开启，
  API 的 IP 限流才按真实客户端地址计数。

完整清单见 `apps/api/.env.example`。凭据放 systemd 的 `EnvironmentFile=`（权限 600），
不要放进仓库。

## 3. systemd 服务

`/etc/systemd/system/jixin-api.service`：

```ini
[Unit]
Description=Jixin logistics API (Hyperledger Fabric)
After=network-online.target

[Service]
User=jixin
WorkingDirectory=/opt/jixin
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3001
Environment=TRUST_PROXY=true
EnvironmentFile=/etc/jixin/api.env
ExecStart=/opt/jixin/bin/jixin-api
Restart=on-failure
RestartSec=3

# 加固
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/jixin

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jixin-api
curl -s http://127.0.0.1:3001/api/network   # 确认 mode=fabric、health.status=ok
```

## 4. Nginx

见同目录 `nginx.conf`：80 强制跳 443，443 托管 `/opt/jixin/web` 并反代 `/api`。
修改 `server_name` 与证书路径后启用。Fabric 提交最长约 80 秒，代理超时已按 120s 配置。

## 5. 上线核对清单

- [ ] `curl https://<域名>/api/network` 返回 `mode=fabric` 且 `health.status=ok`
- [ ] 登录后 cookie 带 `Secure; HttpOnly; SameSite=Lax`
- [ ] 四个账户用哈希密码可登录，源码/仓库中无任何密码
- [ ] 建单 → 接单 → 揽收 → 节点 → 送达 → 签收闭环返回真实 Fabric `transactionId`
- [ ] 公开查询页输入错误运单号连续多次触发 429 限流
- [ ] Fabric 网络是生产拓扑（多机多组织），不是本机 test-network
