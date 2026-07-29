# Go 重构审查报告

更新时间：2026-07-29

工作分支：`codex/go-backend-rewrite`

## 结论

项目保留 React/TypeScript 浏览器端，将 HTTP API、领域服务、持久化演示账本、Fabric Gateway 适配器和 Fabric 智能合约迁移为 Go。前端 HTTP 路径、JSON 字段、物流状态、链码交易名、`logisticschannel`、`logistics` 链码名以及 `SHIPMENT:`/`TRACKING:` 状态键保持兼容。

演示账本与 Fabric 账本仍有严格边界：演示模式的交易号以 `demo-` 开头，公开验真不会把演示结果标成真实上链证明。只有新的 Go 链码在真实 Fabric 网络部署、提交交易并验证重启后持久化，才能宣称本次迁移完成真实链路验收。

## 主要审查发现

### 1. 后端与链码重复维护领域定义

原实现分别在 `packages/shared`、API Ledger 类型和 TypeScript chaincode 中维护运单、事件和温控字段，状态或 JSON 标签修改时容易漂移。

重构后：

- Go 链码模块的 `chaincode/logistics/model` 是 API 与链码共用的 Go JSON 模型。
- `packages/shared` 仅服务浏览器端 TypeScript 类型，不再承担 Node 后端构建。
- API 与链码通过自动化测试校验同一字段和状态序列。

### 2. 公共追踪和健康检查执行全量账本扫描

原 API 为按运单号查询调用 `GetAllShipments` 后在内存查找；Fabric 健康检查也读取全部运单。数据量增长后，这会放大 Gateway、Peer 和 JSON 解码开销。

重构后：

- 公共追踪在 Fabric 模式下直接调用 `ReadShipment(trackingNumber)`，复用 `TRACKING:` 链上索引。
- Go chaincode 新增轻量只读 `Health` 交易，Fabric API 探活不再读取所有运单。

### 3. TypeScript API 路由、鉴权、校验与展示转换集中

原 `apps/api/src/app.ts` 同时负责中间件、认证、校验、业务编排、公开脱敏和完整性判断，修改风险集中。

重构后按职责拆分为：

- `internal/auth`：HMAC-SHA256 JWT 与演示账号认证。
- `internal/config`：环境文件、模式与 Fabric 组织配置。
- `internal/httpapi`：HTTP 路由、严格 JSON 校验、CORS、RBAC、公开脱敏。
- `internal/ledger`：账本接口、演示实现和 Fabric Gateway 实现。
- `chaincode/logistics`：链上状态机、MSP 权限、索引、历史和事件。

### 4. 演示账本需要明确的并发与回滚语义

Go 演示账本使用读写锁串行化写操作；每次变更先保留内存快照，持久化失败时回滚，再通过同目录临时文件替换正式 JSON 文件。重新创建 Ledger 实例后仍能读取完整状态。

### 5. 真实部署仍需生产化加固

以下不是本次课程级迁移的阻塞项，但上线前必须处理：

- 当前演示账号与密码是开发数据，不是生产身份系统。
- Fabric Gateway 连接按请求建立，生产流量下应增加连接复用、生命周期关闭和指标。
- 公开查询尚未配置外部限流、WAF 或反滥用策略。
- 原始证据文件未纳入对象存储、病毒扫描、留存和权限体系。
- 测试网络是单 orderer 教学网络，不是生产拓扑。

## 保持兼容的接口

HTTP 接口继续提供：

- `/api/health`
- `/api/network` 与 `/api/network/mode`
- `/api/auth/login` 与 `/api/auth/me`
- `/api/dashboard/summary`
- `/api/shipments`、详情、历史和八类状态动作
- `/api/public/track/:trackingNumber`
- `/api/public/track/:trackingNumber/history`
- `/api/public/verify`

链码继续提供：

- `CreateShipment`
- `AcceptShipment`
- `PickupShipment`
- `AddCheckpoint`
- `ReportException`
- `ResolveException`
- `MarkDelivered`
- `ConfirmReceipt`
- `CancelShipment`
- `ReadShipment`
- `GetAllShipments`
- `GetShipmentHistory`

新增只读交易：`Health`。

## 清理清单

已删除：

- 原 `apps/api/src` TypeScript 后端及其 Vitest、tsconfig、package 清单。
- 原 `chaincode/logistics/src` TypeScript 链码、测试、npm 锁文件和 package 清单。
- 整个 `output/playwright` 历史截图目录：包含四张旧版受控验收图和 51 张未跟踪的本地 UI 截图，均不参与运行且已无文档引用。
- pnpm 锁文件中仅由 Node API/TypeScript chaincode 引入的 Express、Zod、JWT、Fabric Node SDK、Fabric Node chaincode 和相关传递依赖。

保留：

- React 前端、前端测试与 `packages/shared`。
- Fabric 网络脚本、交接和验收文档。
- `.env.example`，但所有 `.env.fabric`、证书、私钥和 JWT 密钥继续忽略。
- 历史 Fabric 排障文档；其中 Node/TypeScript 内容已明确标注为历史记录。

## 精简后的文件职责

```text
.
├─ apps/
│  ├─ api/
│  │  ├─ cmd/server/           # Go API 入口
│  │  ├─ cmd/seed/             # 演示数据入口
│  │  ├─ internal/
│  │  │  ├─ apperror/          # 统一业务错误
│  │  │  ├─ auth/              # JWT 与账号认证
│  │  │  ├─ config/            # 环境与 Fabric 配置
│  │  │  ├─ httpapi/           # 路由、校验、RBAC、脱敏和闭环测试
│  │  │  ├─ ledger/            # demo/Fabric 账本适配器
│  │  │  └─ users/             # 开发演示账号
│  │  ├─ .env.example
│  │  ├─ go.mod
│  │  └─ go.sum
│  └─ web/                     # React/Vite 前端
├─ chaincode/logistics/
│  ├─ model/                   # API 与链码共享的 Go JSON 模型
│  ├─ contract.go              # 物流状态机和查询
│  ├─ validation.go            # 链上输入校验
│  ├─ contract_test.go         # MSP、状态机、索引和重放测试
│  ├─ main.go                  # Fabric chaincode 入口
│  ├─ go.mod
│  └─ go.sum
├─ packages/shared/            # 前端 TypeScript 类型
├─ network/                    # Fabric 2.5 测试网络和 Go 链码部署
├─ scripts/                    # 环境、格式检查
├─ docs/                       # 设计、验收、迁移与交接
├─ go.work                     # Go workspace
├─ package.json                # 前端与 Go 的统一命令入口
└─ pnpm-workspace.yaml         # 仅包含 Web 与 TS shared 包
```

## 验证入口

```powershell
pnpm build
pnpm test
pnpm test:closed-loop
pnpm typecheck
pnpm lint
pnpm format:check
```

本次已执行 `pnpm fabric:up`，确认 `/api/network` 为 `fabric / ok`，并创建、流转和签收运单 `JX20260729254558`。9 次修改均返回真实 Fabric `transactionId`；重启 Go API 后仍能读取 `RECEIVED` 状态、9 条事件和最终交易 ID。详细证据见 `docs/验收记录.md`。
