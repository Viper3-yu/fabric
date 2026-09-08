# 迹信控制塔（链运集成）说明

## 架构：一条链码，一本账本

控制塔能力已并入迹信统一链码 `chaincode/logistics`，不再存在第二套链码：

| 能力                | 链码方法                                   | 权限                                                         |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| 包裹登记            | `AddParcel`                                | 发货方 Org1MSP，限建单/已接单状态                            |
| 物流单元装箱 / 拆箱 | `PackParcels` / `UnpackParcels`            | 装箱 Org1MSP，拆箱 Org2MSP                                   |
| 双组织交接          | `InitiateHandover` / `ConfirmHandover`     | 发起 Org1MSP，确认 Org2MSP；发起方无法自确认，重复确认被拒绝 |
| 通用节点事件        | `RecordNodeEvent`                          | 双组织均可，不改变运单状态，`actorOrg` 必须与调用方 MSP 一致 |
| 查询                | `GetParcels` / `GetUnits` / `GetHandovers` | 任意读取                                                     |

原有运单状态机（`CreateShipment` → `ConfirmReceipt`）不受影响，历史运单数据无需迁移。

## 服务与运行

`apps/tower-api/` 是控制塔后端（Gin），两种账本模式：

- `LEDGER_MODE=mock`（默认）：零依赖演示，返回 `YT20260001` 演示数据，接口响应显式标注 `dataSource: demo`。
- `LEDGER_MODE=fabric`：连接统一账本，直接查询 JXSEED 等真实运单，需要与 `apps/api` 同源的 Fabric 证书环境变量（`FABRIC_*`，参见 `.env.example`）。

```bash
# 演示模式（写操作需要主站会话，JWT_SECRET 必须与 apps/api 一致）
cd apps/tower-api && GOWORK=off ENV_FILE=../../apps/api/.env.fabric go run ./cmd/server   # 8080，Org1
# 双组织交接演示再起一个 Org2 实例
GOWORK=off ENV_FILE=../../apps/api/.env.fabric TOWER_ORG=2 PORT=8082 go run ./cmd/server

# 测试
GOWORK=off go test ./...
```

前端经 Vite 代理访问：`/lianyun-api` → 8080（Org1）、`/lianyun-org2-api` → 8082（Org2）。这两个路径沿用组员原系统的线上命名，作为稳定 API 表面保留。

MySQL 遥测（网点、路线计划、GPS、温湿度）为**可选链下数据层，默认不启用**，本机演示不需要安装 MySQL。表结构与演示数据在 `deploy/mysql/`，需要时自行起容器并配置 `MYSQL_DSN`。未配置时控制塔使用内置演示路线并在响应中标注 `dataSource: demo`；**一旦配置，查不到数据的运单会直接报错，不会静默回退演示数据**（2026-09-05 审计结论，见 `docs/AUDIT-2026-09-05.md`），因此启用前需先为运单准备路线数据。

## 演示账号

开发演示密码：`shipper / shipper123`、`carrier / carrier123`、`receiver / receiver123`、`auditor / auditor123`。仅限本机开发，不得用于公网部署。

## 会话与双组织权限

控制塔写操作（发起交接、确认交接、追加事件）复用主站 `jixin_session` 会话（同一 `JWT_SECRET` 校验），并按实例组织做角色门控：

| 实例                  | 允许角色  | 可执行操作                    |
| --------------------- | --------- | ----------------------------- |
| 8080（`TOWER_ORG=1`） | `shipper` | 发起交接、追加事件（Org1 侧） |
| 8082（`TOWER_ORG=2`） | `carrier` | 确认交接、追加事件（Org2 侧） |

因此发货方无法确认自己发起的交接（角色门控 + 链码 `requireMSP` 双重拦截），一笔交接必须由两个账号先后完成。读取接口保持开放。链码在发起/确认时还会向运单事件流写入 `HANDOVER_INITIATED` / `HANDOVER_CONFIRMED` 里程碑，公开追溯页可见。

## 区块链具体负责什么

1. 各组织用 Fabric 身份提交交易，链码校验 MSP 权限与状态合法性，双组织背书后上链。
2. 双边交接产生两笔独立交易：Org1 `InitiateHandover`、Org2 `ConfirmHandover`，交接单状态与双方交易 ID 全部在链上可查。
3. 包裹与物流单元的装箱关系上链存证；GPS/温湿度等高频遥测留在 MySQL，关键事件与文件摘要上链。

## 已知局限

- 双组织权限隔离是"主站角色 + 双服务实例"形态：真正的多企业部署需要各企业自持证书、独立部署 API 并限制接收组织。
- 生产化还需：企业独立授权与证书隔离、TLS、审计与备份。
- 未配置 MySQL 时，控制塔路线/地图为**按运单真实起讫生成的示意轨迹**（时间线取自链上事件，温度曲线为链上节点记录的真实温度），响应仍标注 `dataSource: demo`；接入真实 GPS/温湿度设备还需设备身份、采样时间与质量校验。
