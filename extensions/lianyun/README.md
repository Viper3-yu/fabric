# 链运协同：可信物流控制塔

面向货主、承运方和网点的多方物流协同系统。以 **交接确认、物流单元聚合/拆分、异常闭环、GIS 风险定位、单证哈希验真** 为核心；GPS 与温湿度作为可插拔遥测能力。

## 目录

本目录是集成版依赖的原链运源码；React 主项目在仓库根目录，本机访问 **http://localhost:8181**。原版 8081 保留。集成范围、账号、数据边界与 WSL 更新说明见 [集成说明](../../INTEGRATION.md)。

- `chaincode-go/`：Hyperledger Fabric Go 智能合约
- `backend-go/`：Gin REST API、Fabric Gateway 与风险分析
- `frontend-php/`：Apache/PHP 部署的控制塔前端
- `database/`：MySQL 表结构和演示数据
- `mock-demo/`：无需 Go、PHP、Fabric、MySQL 的本地演示服务
- `docs/`：架构、接口、部署和答辩演示

## 一键演示（当前环境可运行）

```bash
cd mock-demo
npm install
npm test
npm start
# 浏览器打开 http://localhost:3100
```

使用运单号 `YT20260001`。模拟服务会返回与正式 Gin API 相同的接口，因此前端可直接验证 GIS、风险定位、包裹关系、异常和温湿度曲线。

## WSL 正式部署

推荐将项目放在 WSL 的 Linux 文件系统（例如 `~/lianyun`），然后执行：

```bash
chmod +x scripts/wsl/*.sh
./scripts/wsl/install-fabric.sh
./scripts/wsl/deploy.sh
./scripts/wsl/status.sh
./scripts/wsl/smoke-test.sh
```

部署后访问 `http://localhost:8081`。Gin API 位于 `http://localhost:8080`，Fabric 通道为 `logisticschannel`。脚本会导入 MySQL 演示数据、启动 test-network、部署链码、执行 `InitLedger`、生成真实 Gateway 配置，并安装 systemd 后端服务。

完整说明见 `docs/部署指南.md`。

若希望 Windows 登录后持续通过 `localhost` 访问 WSL 服务，可在 PowerShell 中执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\keep-wsl-alive.ps1
```

该脚本注册当前用户的 `LianyunWSLKeepAlive` 登录任务，避免 WSL 在没有前台终端时休眠。本机已完成该配置。

## 数据边界

- Fabric：运单摘要、交接、装箱/拆箱、异常、签收哈希、遥测摘要、交易证据。
- MySQL：用户、网点坐标、路线计划、原始 GPS/温湿度、文件元数据。
- 文件目录：签收图、交接单、温湿度 CSV；哈希写入 Fabric。

## 验证

```bash
cd backend-go && go test ./...
cd ../chaincode-go && go test ./...
cd ../mock-demo && npm test
curl http://localhost:8080/api/health
./scripts/wsl/smoke-test.sh
```
