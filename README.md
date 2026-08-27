# 迹信

迹信是一个基于 Hyperledger Fabric 的可信物流追踪系统。当前代码由 React/TypeScript 浏览器端、Go HTTP API、Go Fabric Gateway 适配器、Go 智能合约和闭环自动化测试组成。所有业务记录都写入真实的 Fabric 区块链网络；代码不再包含演示账本或演示数据。

业务架构与状态机见 [设计方案](docs/设计方案.md)，Go 重构审查和精简后的文件职责见 [Go 重构审查报告](docs/Go重构审查报告.md)。

## 环境要求

- Go 1.23 或更高版本
- Node.js 20.12 或更高版本
- pnpm 11
- 已启动的 Docker Desktop，以及 Git for Windows 自带的 Git Bash（Fabric 测试网络需要）

先检查本机环境：

```powershell
pnpm doctor
```

## 快速启动（连接真实 Fabric 网络）

以下命令在 Windows PowerShell 中运行。脚本使用 Git for Windows 的 `bin/bash.exe`，部署 `chaincode/logistics` 中的 Go 链码。Linux/macOS 上同样的 `pnpm fabric:*` 命令直接可用（由 `scripts/run-platform.js` 按平台选择 PowerShell 包装或原生 bash 脚本，`pnpm doctor` 除外——它仅面向 Windows 环境）。

首次准备 Fabric 二进制、镜像和官方测试网络：

```powershell
pnpm fabric:bootstrap
```

启动双组织网络、创建 `logisticschannel`、部署 `logistics` Go 链码，并生成 `apps/api/.env.fabric`（内含本机生成的随机 `JWT_SECRET`）：

```powershell
pnpm fabric:up
```

为需要登录工作台的角色账户设置密码（生成 bcrypt 哈希：`go run ./apps/api/cmd/hash-password 'your-password'`），追加到 `apps/api/.env.fabric`：

```ini
APP_PASSWORD_HASH_SHIPPER=$2a$10$...
APP_PASSWORD_HASH_CARRIER=$2a$10$...
APP_PASSWORD_HASH_RECEIVER=$2a$10$...
APP_PASSWORD_HASH_AUDITOR=$2a$10$...
```

已写入的 `APP_PASSWORD*` 行在每次 `pnpm fabric:up` 重新生成 `.env.fabric` 时会自动保留，不需要重复配置。

然后启动 API 与前端：

```powershell
$env:ENV_FILE = (Resolve-Path ".\apps\api\.env.fabric").Path
pnpm dev
```

浏览器访问 <http://localhost:5173>，API 默认位于 <http://127.0.0.1:3001>。访问 <http://127.0.0.1:3001/api/network>，确认 `mode` 为 `fabric` 且 `health.status` 为 `ok`。所有修改响应都会返回 Fabric `transactionId`；签收码通过 transient data 提交，不写入交易参数、区块状态或链码事件。

如果想让工作台和公开页有可浏览的记录，可以写入一组覆盖各状态的预置运单（12 个，全部真实上链，可重复执行——已存在的会跳过）：

```powershell
$env:ENV_FILE = (Resolve-Path ".\apps\api\.env.fabric").Path
pnpm seed
```

推荐闭环：发货方建单并保存系统返回的 6 位签收码；承运方依次接单、揽收、更新节点、处理异常并送达；收货方用签收码确认收货；最后使用公开查询页核对脱敏轨迹和交易历史。

停止测试网络：

```powershell
pnpm fabric:down
```

`apps/api/.env.fabric` 含本机证书和私钥路径，已被 Git 忽略，不得提交。测试网络不是生产网络模板。

## 内置角色账户

系统内置四个角色账户：`shipper`（创建运单、取消待接单运单）、`carrier`（接单、揽收、节点更新、异常处理、送达）、`receiver`（输入一次性签收码确认收货）、`auditor`（查看运单历史和交易证据）。

源代码不再包含任何密码。凭据通过环境变量提供：`APP_PASSWORD_<账号>`（明文，仅限本地开发）或 `APP_PASSWORD_HASH_<账号>`（bcrypt 哈希，优先级更高；`NODE_ENV=production` 下每个账户必须配置其一，否则服务拒绝启动）。`JWT_SECRET` 在任何环境都要求至少 16 个字符。详见 `apps/api/.env.example`。

## 构建、测试与格式

```powershell
pnpm build
pnpm test
pnpm test:closed-loop
pnpm test:fabric
pnpm typecheck
pnpm lint
pnpm format:check
```

这些命令同时覆盖 React/TypeScript 前端、Go API 和 Go chaincode。单元与闭环测试使用文件型测试替身（`apps/api/internal/ledger/fake`）模拟链上状态机，不需要 Docker；`pnpm test:fabric` 在测试网络运行中执行建单到签收的真实链上闭环（`TestFabricClosedLoopIntegration`），无 Docker 时自动跳过，不影响 CI。

## 目录

- `apps/web`：React 浏览器端。
- `apps/api`：Go API、JWT/RBAC 和 Fabric Gateway 适配器（`internal/ledger/fake` 仅供测试）。
- `packages/shared`：前端使用的 TypeScript API/领域类型。
- `chaincode/logistics`：Go 智能合约及唯一的 Go 物流 JSON 模型。
- `network`：Fabric 官方测试网络启动、部署与环境生成脚本。
- `scripts`：环境和格式检查脚本。
- `deploy`：生产部署示例（Nginx 配置、systemd 单元、上线核对清单）。
- `docs`：设计、验收、迁移审查和项目说明。

Go workspace 位于 `go.work`；API 与链码分别拥有独立 `go.mod`，因此链码目录可以被 Fabric 单独打包。
