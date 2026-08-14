# 迹信

迹信是一个基于 Hyperledger Fabric 的可信物流追踪系统。当前代码由 React/TypeScript 浏览器端、Go HTTP API、Go Fabric Gateway 适配器、Go 智能合约、持久化演示账本和闭环自动化测试组成。

业务架构与状态机见 [设计方案](docs/设计方案.md)，Go 重构审查和精简后的文件职责见 [Go 重构审查报告](docs/Go重构审查报告.md)。

## 环境要求

- Go 1.23 或更高版本
- Node.js 20.12 或更高版本
- pnpm 11
- Fabric 模式额外需要已启动的 Docker Desktop，以及 Git for Windows 自带的 Git Bash

先检查本机环境：

```powershell
pnpm doctor
```

## 演示模式快速启动

演示模式不需要 Docker，适合开发、界面预览和自动化测试。

```powershell
pnpm install
pnpm dev
```

浏览器访问 <http://localhost:5173>，API 默认位于 <http://127.0.0.1:3001>。首次启动会在 `apps/api/data/demo-ledger.json` 创建持久化演示数据。页面与 API 会明确显示“演示账本”；这些交易不能作为真实上链证明。

单独补充演示数据：

```powershell
pnpm seed
```

### 演示账号

| 角色     | 用户名     | 密码          | 主要操作                             |
| -------- | ---------- | ------------- | ------------------------------------ |
| 发货方   | `shipper`  | `shipper123`  | 创建运单、取消待接单运单             |
| 承运方   | `carrier`  | `carrier123`  | 接单、揽收、节点更新、异常处理、送达 |
| 收货方   | `receiver` | `receiver123` | 输入一次性签收码确认收货             |
| 审计访客 | `auditor`  | `auditor123`  | 查看运单历史和交易证据               |

上表密码是开发与课程演示回退值。部署时用 `DEMO_PASSWORD_<账号>` 覆盖明文密码，或用 `DEMO_PASSWORD_HASH_<账号>` 注入 bcrypt 哈希（哈希优先，`NODE_ENV=production` 必须配置），生成哈希：`go run ./apps/api/cmd/hash-password`。详见 `apps/api/.env.example`。

推荐闭环：发货方建单并保存系统返回的 6 位签收码；承运方依次接单、揽收、更新节点、处理异常并送达；收货方用签收码确认收货；最后使用公开查询页核对脱敏轨迹和交易历史。

## Hyperledger Fabric 模式

以下命令在 Windows PowerShell 中运行。脚本使用 Git for Windows 的 `bin/bash.exe`，部署 `chaincode/logistics` 中的 Go 链码。

首次准备 Fabric 二进制、镜像和官方测试网络：

```powershell
pnpm fabric:bootstrap
```

启动双组织网络、创建 `logisticschannel`、部署 `logistics` Go 链码，并生成 `apps/api/.env.fabric`：

```powershell
pnpm fabric:up
```

设置 API 环境文件和本次运行的 JWT 密钥：

```powershell
$env:ENV_FILE = (Resolve-Path ".\apps\api\.env.fabric").Path
$env:JWT_SECRET = "$([guid]::NewGuid())$([guid]::NewGuid())"
pnpm dev
```

访问 <http://127.0.0.1:3001/api/network>，确认 `mode` 为 `fabric` 且 `health.status` 为 `ok`。所有修改响应都会返回 Fabric `transactionId`；签收码通过 transient data 提交，不写入交易参数、区块状态或链码事件。

停止测试网络：

```powershell
pnpm fabric:down
```

`apps/api/.env.fabric` 含本机证书和私钥路径，已被 Git 忽略，不得提交。课程测试网络不是生产网络模板。

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

这些命令同时覆盖 React/TypeScript 前端、Go API 和 Go chaincode。在没有 Docker 的机器上可以完成演示闭环、编译和单元测试，但不能据此声称完成真实 Fabric 网络交易验证。`pnpm test:fabric` 在测试网络运行中执行建单到签收的真实链上闭环（`TestFabricClosedLoopIntegration`），无 Docker 时自动跳过，不影响 CI。

## 目录

- `apps/web`：React 浏览器端。
- `apps/api`：Go API、JWT/RBAC、演示账本和 Fabric Gateway 适配器。
- `packages/shared`：前端使用的 TypeScript API/领域类型。
- `chaincode/logistics`：Go 智能合约及唯一的 Go 物流 JSON 模型。
- `network`：Fabric 官方测试网络启动、部署与环境生成脚本。
- `scripts`：环境和格式检查脚本。
- `docs`：设计、验收、迁移审查和项目说明。

Go workspace 位于 `go.work`；API 与链码分别拥有独立 `go.mod`，因此链码目录可以被 Fabric 单独打包。
