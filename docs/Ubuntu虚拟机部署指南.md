# 迹信 Ubuntu 虚拟机部署指南

目标形态：一台 Ubuntu 22.04+ 虚拟机，Docker 内跑双组织 Fabric 测试网络（org1 + org2 + 排序节点 + CouchDB），本机常驻 Go API（systemd 托管），Nginx 托管前端静态文件并反代 `/api`。Windows 开发机用浏览器直接访问虚拟机。

这是"单机完整跑通真实 Fabric 网络"的部署。与 `deploy/README.md` 描述的多机生产拓扑（每组织独立机器、正式 TLS 证书）的差异见文末清单。

## 0. 虚拟机规格

- Ubuntu 22.04 LTS 或 24.04 LTS，4 vCPU、内存 ≥6 GB（Fabric 7 个容器 + CouchDB 比较吃内存）、磁盘 ≥40 GB。
- 网络二选一：
  - **桥接（Bridged）**：虚拟机获得局域网独立 IP，宿主机直接访问，最省事。
  - **NAT + 端口转发**：例如 VirtualBox 中将宿主机 `8080` 转发到虚机 `80`。注意第 6 节 Secure cookie 的说明。
- 能访问外网：GitHub（下载 Fabric 安装脚本与二进制）、Docker Hub（拉镜像）、Go 模块代理（脚本已默认走 `goproxy.cn`）。

## 1. 安装基础依赖

```bash
sudo apt update
sudo apt install -y git curl jq build-essential ca-certificates openssl

# Docker Engine + Compose v2 插件（test-network 需要 docker compose 子命令）
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
# 注销并重新登录，使 docker 组生效；重新登录后验证：
docker ps && docker compose version

# Go ≥1.23（版本号以 https://go.dev/dl/ 为准）
GO_VER=1.25.0
curl -fL -o /tmp/go.tgz "https://golang.google.cn/dl/go${GO_VER}.linux-amd64.tar.gz"
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf /tmp/go.tgz
printf '\nexport PATH=$PATH:/usr/local/go/bin:$HOME/go/bin\n' >> ~/.bashrc && source ~/.bashrc

# Node.js ≥20.12（22 LTS 即可）与 pnpm 11
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable          # 进入项目目录后 corepack 会自动使用 package.json 固定的 pnpm@11.9.0
```

## 2. 获取代码

方式 A —— 推送后在虚拟机上克隆（仓库为私有库时需给虚拟机配 SSH key）：

```bash
git clone <你的仓库地址> ~/jixin
cd ~/jixin && pnpm install --frozen-lockfile
```

方式 B —— 从 Windows 直接打包拷贝（跳过 GitHub 认证）。在 Windows 的 Git Bash 中：

```bash
cd "/c/Users/25868/Total PR"
tar --exclude='blockchain/node_modules' \
    --exclude='blockchain/network/fabric-samples' \
    --exclude='blockchain/.pnpm-store' \
    --exclude='blockchain/tmp' \
    --exclude='blockchain/apps/api/.env.fabric' \
    -czf jixin-src.tar.gz blockchain
scp jixin-src.tar.gz user@<虚机IP>:~/
```

在虚拟机上解包并安装依赖。注意 fabric-samples 必须排除：里面的 `bin/` 是 Windows exe，Linux 上要用安装器重新下载对应平台二进制。

```bash
tar xzf ~/jixin-src.tar.gz && mv ~/blockchain ~/jixin
cd ~/jixin
find . -name '*.sh' -type f -exec chmod +x {} +   # tar 方式会丢执行位，git clone 则不用
pnpm install --frozen-lockfile
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm -v         # 首次触发 corepack 下载 pnpm 11
```

## 3. 启动 Fabric 网络并部署链码

与 Windows 完全相同的两条命令（`scripts/run-platform.js` 会按平台自动选择原生 bash 脚本）：

```bash
cd ~/jixin
pnpm fabric:bootstrap     # 下载 Fabric 2.5.16 二进制、镜像和 fabric-samples（约几分钟）
pnpm fabric:up            # 建网 + 建 logisticschannel + 部署 logistics 链码 + 生成 .env.fabric
```

`fabric:up` 内部的 `start-fabric.sh` 会自动清理旧网络、创建 `logisticschannel`（CA + CouchDB）、把 `chaincode/logistics` 部署为 `logistics` 链码（v1.0 Sequence 1），最后打印容器列表——正常应看到 peer0.org1、peer0.org2、orderer、两个 CA、两个 CouchDB 共 7 个容器。脚本内部已默认 `GOPROXY=https://goproxy.cn` 并对链码模块关闭 go.work。

## 4. 配置 API 环境变量文件

`pnpm fabric:up` 末尾的 `write-env.sh` 已生成 `apps/api/.env.fabric`（JWT_SECRET、两个组织的证书与私钥路径）。还需要为角色账户追加密码（先改掉示例密码）：

```bash
cd ~/jixin
{
  echo "APP_PASSWORD_HASH_SHIPPER=$(go run ./apps/api/cmd/hash-password '改成你的密码')"
  echo "APP_PASSWORD_HASH_CARRIER=$(go run ./apps/api/cmd/hash-password '改成你的密码')"
  echo "APP_PASSWORD_HASH_RECEIVER=$(go run ./apps/api/cmd/hash-password '改成你的密码')"
  echo "APP_PASSWORD_HASH_AUDITOR=$(go run ./apps/api/cmd/hash-password '改成你的密码')"
} >> apps/api/.env.fabric
chmod 600 apps/api/.env.fabric
```

要点：

- 该文件含私钥路径，已被 `.gitignore` 忽略，不得提交或打包传输。
- 再次执行 `pnpm fabric:up` 推倒重建网络时，`write-env.sh` 会重写证书路径但**保留已写入的 `APP_PASSWORD*` 行**，密码只需配置一次。
- 部署到 `/etc/jixin/api.env` 之后，虚拟机源码目录里的这个文件就与运行态无关了；更新它不会影响 systemd 服务。

本地冒烟（可选）：`ENV_FILE="$PWD/apps/api/.env.fabric" pnpm dev`，然后 `curl http://127.0.0.1:3001/api/network` 应返回 `"mode":"fabric"`。

## 5. 构建产物

```bash
cd ~/jixin
pnpm build                                            # shared/web 构建 + Go 编译检查
CGO_ENABLED=0 go build -o bin/jixin-api ./apps/api/cmd/server
CGO_ENABLED=0 go build -o bin/jixin-seed ./apps/api/cmd/seed
```

## 6. 常驻服务（systemd + Nginx）

### 6.1 决定运行环境（重要）

API 登录 cookie 的 `Secure` 标志与 `NODE_ENV=production` 绑定（`apps/api/internal/httpapi/server.go`）。Secure cookie 只会通过 HTTPS 或 localhost 发送——用局域网 IP 经 HTTP 访问时浏览器会丢弃会话 cookie，表现为"登录永远不成功"。三种选择：

| 场景                           | 做法                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 局域网 IP + HTTP 直访          | env 里保持 `NODE_ENV=development`，四个账户照样用哈希登录；牺牲的是 Secure 标志与 production 强校验                       |
| NAT 端口转发到宿主机 localhost | 宿主机访问 `http://localhost:<端口>`；浏览器把 localhost 视为安全上下文，可用 `NODE_ENV=production` 且 Secure cookie 正常 |
| 有公网域名                     | 上 certbot HTTPS，按 `deploy/nginx.conf` 原样启用，`NODE_ENV=production`                                                  |

下文按最常见的"局域网 IP 直访"写：环境文件里不加 `NODE_ENV=production`。

### 6.2 安装文件与环境

```bash
sudo useradd --system --home-dir /opt/jixin --shell /usr/sbin/nologin jixin
sudo mkdir -p /opt/jixin/bin /opt/jixin/web /etc/jixin
sudo install -m 755 ~/jixin/bin/jixin-api /opt/jixin/bin/jixin-api
sudo cp -r ~/jixin/apps/web/dist/. /opt/jixin/web/

# 环境文件 = 第 4 步生成的内容 + 反向代理相关开关
sudo cp ~/jixin/apps/api/.env.fabric /etc/jixin/api.env
cat <<EOF | sudo tee -a /etc/jixin/api.env >/dev/null
HOST=127.0.0.1
PORT=3001
TRUST_PROXY=true
EOF
sudo chown jixin:jixin /etc/jixin/api.env && sudo chmod 600 /etc/jixin/api.env
```

若选择 `NODE_ENV=production`（localhost 转发或 HTTPS 场景），在上面追加一行 `NODE_ENV=production`——缺四个哈希会拒绝启动，我们已配好。

### 6.3 systemd 单元

`/etc/systemd/system/jixin-api.service`（比 `deploy/README.md` 模板更精简：所有变量集中在 EnvironmentFile）：

```ini
[Unit]
Description=Jixin logistics API (Hyperledger Fabric)
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=jixin
WorkingDirectory=/opt/jixin
EnvironmentFile=/etc/jixin/api.env
ExecStart=/opt/jixin/bin/jixin-api
Restart=on-failure
RestartSec=3
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
systemctl status jixin-api --no-pager
curl -s http://127.0.0.1:3001/api/network      # mode=fabric 且 health.status=ok
```

### 6.4 Nginx（局域网 HTTP 变体）

```bash
sudo apt install -y nginx
sudo tee /etc/nginx/sites-available/jixin >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    root /opt/jixin/web;
    index index.html;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # SPA 路由回退：/track、/verify、/app/* 都返回 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Fabric 提交最长可等 ~80s，要高于 API WriteTimeout(100s)
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        client_max_body_size 1m;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/jixin /etc/nginx/sites-enabled/jixin
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

有域名上 HTTPS 时不要用这段，改用 `deploy/nginx.conf` 原配置并用 certbot 签发证书。

### 6.5 防火墙与访问

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp       # 或你实际映射的端口
sudo ufw enable
```

宿主机浏览器访问 `http://<虚机IP>/`（NAT 场景是转发规则里的宿主机端口）。用 shipper/carrier/receiver/auditor 任一账户登录，建单到签收闭环中每个写操作响应都应带 Fabric `transactionId`。

## 7. 写入预置运单（可选）

```bash
sudo -u jixin ENV_FILE=/etc/jixin/api.env /opt/jixin/bin/jixin-seed
```

幂等，重复执行会跳过已存在的运单；公开查询页因此有脱敏轨迹可看。

## 8. 日常运维

```bash
journalctl -u jixin-api -f                      # API 日志
sudo systemctl restart jixin-api                # 改环境变量后重启

cd ~/jixin && git pull && pnpm install          # 更新代码
pnpm build && CGO_ENABLED=0 go build -o bin/jixin-api ./apps/api/cmd/server
sudo install -m 755 bin/jixin-api /opt/jixin/bin/jixin-api && sudo systemctl restart jixin-api
sudo cp -r apps/web/dist/. /opt/jixin/web/      # 前端有改动时

pnpm fabric:up                                  # 推倒重建网络（密码行保留，但 keystore 文件名每次随机）
# 重建后必须重新拷贝环境文件（源文件里已保留密码行，只需再补反代开关）：
sudo cp ~/jixin/apps/api/.env.fabric /etc/jixin/api.env
printf 'HOST=127.0.0.1\nPORT=3001\nTRUST_PROXY=true\n' | sudo tee -a /etc/jixin/api.env >/dev/null
sudo chown jixin:jixin /etc/jixin/api.env && sudo chmod 600 /etc/jixin/api.env
sudo systemctl restart jixin-api
```

排查顺序：容器是否齐全（`docker ps` 应 7 个）→ `/api/network` 的 health → systemd 日志 → 是否重建过网络导致 `/etc/jixin/api.env` 里的证书路径漂移。

## 9. 与真实生产拓扑的差距

当前部署跑的是官方 test-network（单机 Docker、cryptogen 生成的开发证书）。对照 `deploy/README.md` 的上线核对清单，这些仍是差距项，接入多机多组织生产网络时要替换：

- 生产网络模板（每组织独立 peer/orderer 节点与独立 MSP，非同进程容器）
- 由 Fabric CA 按组织签发的正式身份证书（并把 `/etc/jixin/api.env` 的路径指向新证书）
- TLS 终止：域名 + 有效证书 + 强制 HTTPS（启用 `deploy/nginx.conf` 原样配置）
- 每个 RoleAccount 使用独立强密码，`JWT_SECRET` 只存在于该环境文件中
