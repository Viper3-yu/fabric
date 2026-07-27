# 迹信

迹信是一个基于 Hyperledger Fabric 的可信物流追踪系统，包含 React 浏览器端、Express API、双组织 Fabric Gateway 接入、TypeScript 智能合约、演示账本和闭环自动化测试。

详细架构、状态机和课程要求映射见 [设计方案](docs/设计方案.md)。

## 环境要求

- Node.js 20.12 或更高版本
- pnpm 11
- Fabric 模式额外需要已启动的 Docker Desktop，以及 Git for Windows 自带的 Git Bash

可先检查本机环境：

```powershell
pnpm doctor
```

## 演示模式快速启动

演示模式不需要 Docker，适合开发、界面预览和自动化测试。

```powershell
pnpm install
pnpm dev
```

浏览器访问 <http://localhost:5173>。API 默认位于 <http://127.0.0.1:3001>。首次启动会在 `apps/api/data/demo-ledger.json` 创建持久化演示数据，页面和 API 均会明确显示“演示账本”；这些交易不能作为真实上链证明。

需要单独补充演示数据时可运行：

```powershell
pnpm seed
```

### 可登录账号

| 角色     | 用户名     | 密码          | 主要操作                             |
| -------- | ---------- | ------------- | ------------------------------------ |
| 发货方   | `shipper`  | `shipper123`  | 创建运单、取消待接单运单             |
| 承运方   | `carrier`  | `carrier123`  | 接单、揽收、节点更新、异常处理、送达 |
| 收货方   | `receiver` | `receiver123` | 输入一次性签收码确认收货             |
| 审计访客 | `auditor`  | `auditor123`  | 查看运单历史和交易证据               |

推荐演示闭环：发货方建单并保存系统返回的 6 位签收码；承运方依次接单、揽收、更新节点、处理异常并送达；收货方用签收码确认收货；最后使用公开查询页核对脱敏轨迹和交易历史。

## Hyperledger Fabric 模式

以下命令在 Windows PowerShell 中运行。脚本只使用 Git for Windows 的 `usr/bin/bash.exe`（其次才是同一 Git 安装内的 `bin/bash.exe`），不会误用 WSL 的 `bash.exe`。

首次准备 Fabric 二进制、镜像和官方测试网络：

```powershell
pnpm fabric:bootstrap
```

启动双组织网络、创建 `logisticschannel`、部署链码，并生成 `apps/api/.env.fabric`：

```powershell
pnpm fabric:up
```

为 API 指定生成的环境文件，并设置本次运行的 JWT 密钥：

```powershell
$env:ENV_FILE = (Resolve-Path ".\apps\api\.env.fabric").Path
$env:JWT_SECRET = "$([guid]::NewGuid())$([guid]::NewGuid())"
pnpm dev
```

API 启动日志应显示 `ledger=fabric`。也可访问 <http://127.0.0.1:3001/api/network>，确认 `mode` 为 `fabric` 且 `health.status` 为 `ok`。所有建单和状态变更响应都会返回 Fabric `transactionId`；签收码通过 transient data 提交，不写入区块或事件。

停止测试网络：

```powershell
pnpm fabric:down
```

若要在同一 PowerShell 会话中切回演示模式，请先清理 Fabric 启动变量：

```powershell
Remove-Item Env:ENV_FILE -ErrorAction SilentlyContinue
Remove-Item Env:JWT_SECRET -ErrorAction SilentlyContinue
```

`apps/api/.env.fabric` 含本机证书和密钥路径，已被 Git 忽略，不应提交或复制到其他机器。Fabric 测试网络用于课程验收，不是生产网络模板。

## 构建与测试

```powershell
pnpm build
pnpm test
pnpm test:closed-loop
pnpm typecheck
```

在未安装 Docker 的机器上可以完成演示闭环、构建和自动化测试，但无法声称已完成真实 Fabric 容器网络验证。

## 目录

- `apps/web`：浏览器端
- `apps/api`：JWT/RBAC API、演示账本和 Fabric Gateway 适配器
- `packages/shared`：前后端共享领域类型
- `chaincode/logistics`：物流智能合约
- `network`：Fabric 官方测试网络启动与环境生成脚本
- `docs`：设计方案和课程要求说明
