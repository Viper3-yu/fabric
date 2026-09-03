# 迹信 × 链运：本机集成版

## 当前交付范围

以组员 Viper3-yu/fabric 的 React / Carbon 前端和 Go 业务 API 为基础，保留其公开查询、角色登录、运单生命周期和验真页面，增加运输控制塔、双边交接与物流单元、数据源与扩展设置。

这是第一阶段的**界面和服务集成**，不是两套业务模型已经完全合并。组员运单 `JXSEED0001`–`JXSEED0012` 位于 `jixin` 链码；原控制塔演示运单 `YT20260001` 位于 `lianyun` 链码。新建迹信运单目前不会自动生成链运遥测或装箱数据。

## 打开与登录

- 集成版：http://localhost:8181
- 控制塔：http://localhost:8181/app/control-tower（查询 `YT20260001`）
- 双边交接：http://localhost:8181/app/handovers
- 扩展设置：http://localhost:8181/app/settings/integrations
- 原版本保留：http://localhost:8081

本机演示账号：`shipper / shipper123`、`carrier / carrier123`、`receiver / receiver123`、`auditor / auditor123`。这些是开发密码，不得用于公网部署。

## 服务与数据边界

| 浏览器入口           | WSL 服务                            | 数据来源                            |
| -------------------- | ----------------------------------- | ----------------------------------- |
| `/api/`              | `jixin-integrated-api`，3001        | Fabric `jixin`，角色业务流程        |
| `/lianyun-api/`      | `lianyun-backend`，8080             | Fabric `lianyun` + MySQL，Org1 身份 |
| `/lianyun-org2-api/` | `lianyun-org2-backend`，8082        | Fabric `lianyun`，Org2 身份确认     |
| 前端 8181            | Apache，`/var/www/jixin-integrated` | React 构建产物                      |

Fabric 通道为 `logisticschannel`，Org1 peer 21051，Org2 peer 22051，orderer 21050。已部署 `jixin` v1.0 sequence 1、`lianyun` v1.1 sequence 2。链码升级没有重置原账本。

遥测、网点与路线是演示数据；接入 MySQL 不等同于已接入真实 GPS/温湿度设备。原控制塔服务在没有可用数据库读数时仍有示例数据回退，生产化前需改成显式的缺失/错误状态。

## 区块链具体负责什么

1. 各组织用 Fabric 身份提交业务交易，智能合约验证允许的操作，并保存共享账本状态。
2. 双边交接先由 Org1 调用 `InitiateHandover`，再由 Org2 调用 `ConfirmHandover`，产生不同交易 ID。合约拒绝发起方自行确认和重复确认。
3. 前端“交接记录”“事件与交易记录”展示组织、时间和交易 ID。风险责任段则把业务事件与链下路线、遥测关联；风险分析结果本身并不因此成为链上事实。
4. 文件或遥测摘要可以用哈希做一致性核验。哈希只能说明内容是否与留存摘要一致，不能证明首次录入的数据真实，也不能保证传感器没有作弊。

目前双边操作通过两个本机服务身份演示；同一个登录者可点击两个按钮，桥接 API 尚未实现企业级用户授权隔离。不能作为生产级多方独立签署系统对外开放。完整生产化还需限定接收组织、业务权限、证书隔离、TLS、审计与备份。

## 设置的真实行为

- GPS：控制地图上实际轨迹的显示。
- 地图与网点：控制地图面板的显示。
- 温湿度：控制监控面板的显示。
- 证据摘要：显示已有事件的证据哈希，不触发新的锚定交易。
- 控制塔服务路径：实际用于查询和发起交接，限定为同源代理路径；Org2 确认使用单独的固定代理。

设置保存到当前浏览器，重新进入控制塔生效；不停止后台采集、不删除证据。现在是内置扩展启用配置，**不是第三方插件安装器**。连接状态由健康检查产生，不再固定显示“已连接”。

## 在这台 WSL 上更新

### 从本 fork 获取完整源码

本 fork 已将原链运项目源码一并保存在 `extensions/lianyun/`。部署脚本默认沿用本机两个 Linux 工作目录；新环境需将该目录复制到自己的链运工作目录，或设置 `LIANYUN_PROJECT_ROOT` 指向它。Fabric 网络、MySQL、服务配置仍需先初始化，不能只启动 React 就获得链上/遥测数据。

仓库内的凭据均为公开演示占位值；真实 `.env`、Fabric 身份材料和账本未上传。首次配置时请使用自己的证书和密码。原项目的文档、许可证和作者信息保留。

Linux 源码目录：`/home/beetles/integrated-jixin`；原项目：`/home/beetles/lianyun`。修改 Windows 工作区后，先同步改动到对应 Linux 目录，勿覆盖 `.env`、账本目录或 MySQL 数据。

```bash
cd /home/beetles/integrated-jixin
# 仅首次给现有通道添加 jixin；存在则安全跳过
bash deploy/wsl/deploy-jixin-chaincode.sh
# 依赖锁定安装、构建、服务及反向代理配置
bash deploy/wsl/install-integrated.sh
# 会在 YT20260001 上新增一对真实交接事件，不是只读检查
bash deploy/wsl/verify-integrated.sh
```

以上脚本以已有 Fabric 网络、原链运后端和 MySQL 为前提，不是空白机器全自动安装器。不要为了重启运行原项目 `scripts/wsl/deploy.sh`，它含有 network down 和初始化步骤，会重建网络。

正常启动/查看状态：

```bash
sudo systemctl start docker mysql apache2 lianyun-backend lianyun-org2-backend jixin-integrated-api
systemctl is-active docker mysql apache2 lianyun-backend lianyun-org2-backend jixin-integrated-api
curl --noproxy '*' http://127.0.0.1:8181/api/health
```

Windows 已有 `LianyunWSLKeepAlive` 登录任务；如未运行，可在 PowerShell 执行 `Start-ScheduledTask -TaskName LianyunWSLKeepAlive`。首次启动 Fabric 容器可能需要片刻。

## 验证与后续优先级

已运行 `pnpm test`（22 项前端测试及 Go API/链码测试）、`pnpm typecheck`、`pnpm build`、原后端 Go 测试，以及真实 Fabric 双边交接验收。原链运链码目前没有独立 Go 单元测试文件，真实交接检查不能代替完整的合约测试集。

下一阶段优先统一运单主键与事件模型、桥接 API 的角色授权、真实设备数据和缺失状态，再扩展扫码交接、异常工单、通知订阅、可下载证据包。不要先增加更多仅有外观的插件卡片。
