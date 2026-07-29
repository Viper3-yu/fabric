# Fabric 真实网络接入交接

更新时间：2026-07-28
工作区：`C:\Users\25868\blockchain`

> 状态提示：本文保留 Fabric 接入过程、真实写入验收和故障排查细节。最新整体
> 状态、启动方式、能力边界、Git 流程和后续优先级见
> [`项目后续开发交接.md`](./项目后续开发交接.md)。本文第 1、4、8 节描述的
> 分支和未提交状态属于接入当时的历史快照，不再代表当前工作区。
> 2026-07-29 起，API、Fabric Gateway 适配器和链码已迁移为 Go；本文中的
> Node/TypeScript 构建镜像、`tsx`、`dist/server.js` 和 npm 链码故障仅作历史
> 排障记录。当前命令与目录以根目录 `README.md` 和 `docs/Go重构审查报告.md` 为准。

## 1. 已完成事项

前端视觉与交互改动已经完成提交、合并和推送：

- UI 开发分支：`codex/ui-progress-polish`
- UI 提交：`5e6912b feat: polish logistics tracking experience`
- `main` 已快进合并到 `5e6912b`
- `origin/main` 已推送到 `5e6912b`
- UI 分支也已推送到 `origin/codex/ui-progress-polish`

真实 Fabric 接入工作已从最新主分支单独创建：

- 当前分支：`codex/fabric-live-ledger`
- 当前基线：`5e6912b`
- Fabric 分支独立维护，未经用户审核不得合并到 `main`

## 2. 已确认的项目架构

项目并非只有演示账本，真实 Fabric 写入代码已经存在：

- `apps/api/src/ledger/types.ts`：统一账本接口
- `apps/api/src/ledger/demo-ledger.ts`：本地 JSON 演示账本
- `apps/api/src/ledger/fabric-ledger.ts`：双组织 Fabric Gateway 适配器
- `chaincode/logistics/src/logistics-contract.ts`：物流生命周期链码
- `network/`：Fabric 官方 `fabric-samples/test-network` 启动脚本

当 `LEDGER_MODE=fabric` 时，API 会使用 `FabricLedger`。建单、接单、揽收、运输节点、异常、送达、签收和取消均已映射到链码交易。成功响应会返回 Fabric `transactionId`，签收码通过 transient data 提交，不写入区块正文。

因此下一步重点是把本机网络可靠启动并完成真实写入验收，而不是重新实现账本业务。

## 3. 当前本机环境

已确认：

- Docker Desktop：29.6.2，Engine 正常运行
- Node.js：v24.15.0
- pnpm：11.9.0
- Git Bash：`C:\Program Files\Git\bin\bash.exe`
- Fabric CLI：2.5.16，已下载
- Fabric CA CLI：1.5.15，已下载
- `fabric-samples/test-network`：已下载

已存在的 Docker 镜像：

- `hyperledger/fabric-peer:2.5.16`
- `hyperledger/fabric-orderer:2.5.16`
- `hyperledger/fabric-ccenv:2.5.16`
- `hyperledger/fabric-baseos:2.5.16`
- `hyperledger/fabric-ca:1.5.15`
- `hyperledger/fabric-nodeenv:2.5`
- `couchdb:3.4.2`

验收完成时的运行状态：

- Org1、Org2 peer、orderer、两个 CouchDB 和两个物流链码容器正常运行
- API 在 `127.0.0.1:3001` 以 `ledger=fabric` 运行
- 三个 Fabric CA 已完成身份签发；后续使用缓存身份启动时不需要常驻
- `apps/api/.env.fabric` 已生成
- 项目本地 `network/bin/jq.exe` 已通过固定 SHA-256 校验
- `network/fabric-samples/` 和 `network/install-fabric.sh` 已被 `.gitignore` 排除

## 4. 当前未提交改动

`codex/fabric-live-ledger` 分支有以下修改：

- `.gitignore`
- `README.md`
- `apps/api/src/config.ts`
- `chaincode/logistics/package-lock.json`
- `network/bootstrap.ps1`
- `network/ensure-jq.ps1`
- `network/resolve-git-bash.ps1`
- `network/start-fabric.sh`
- `network/start.ps1`
- `network/stop.ps1`
- `network/write-env.ps1`
- `docs/Fabric真实网络接入交接.md`

改动目的：

1. Git Bash 改为优先选择 `Git\bin\bash.exe`。
2. 所有 Fabric Bash 脚本使用 `--login` 启动，确保 `uname`、`sed`、`tr` 等命令可用。
3. `bootstrap.ps1` 增加 Fabric CLI 和 Docker 镜像完整性校验，避免官方安装器下载失败却返回成功码。
4. 首次启动时允许忽略“空网络清理”的非零状态。
5. `stop.ps1` 改为幂等清理；只有仍存在 Fabric 容器时才判定停止失败。
6. 使用 `MSYS2_ENV_CONV_EXCL=DOCKER_SOCK`，只保护 Docker socket 路径，不阻止 Windows Fabric CLI 的 `/c/...` 路径转换。
7. `start-fabric.sh` 会在关键证书缺失时，只清理测试网络内六个可再生目录并重新签发身份，避免残缺 CA 产物再次阻断启动。
8. 准备经过 SHA-256 校验的项目本地 jq 和 Node 链码构建镜像。
9. 使用 standalone npm lockfile 打包链码，避免容器引用 monorepo 外部 pnpm 目录。
10. API 支持通过 `ENV_FILE` 读取 Fabric 配置，生成的文件使用无 BOM UTF-8。

不要丢弃这些修改，也不要直接在 `main` 上继续。

## 5. 已遇到并解决的问题

### 5.1 Git Bash 缺少基础命令

直接调用 `Git\usr\bin\bash.exe` 且不使用登录模式时，官方安装器找不到 `uname`、`tr`、`sed`。

处理：

- Bash 调用增加 `--login`
- 解析器优先返回 `Git\bin\bash.exe`

### 5.2 Fabric 安装器识别出错误系统名

`usr/bin/bash.exe` 返回 `MSYS_NT`，官方安装器只会把 `MINGW64_NT` 映射成 Windows，导致下载不存在的：

`hyperledger-fabric-msys_nt-...tar.gz`

处理后使用正确地址：

`hyperledger-fabric-windows-amd64-2.5.16.tar.gz`

### 5.3 官方安装器会“假成功”

二进制下载失败后，官方脚本部分路径仍可能返回 0。

处理：

- `bootstrap.ps1` 现在检查 `test-network/network.sh`
- 检查 `fabric-samples/bin/peer.exe`
- 检查 `hyperledger/fabric-peer:2.5.16` 镜像

`pnpm fabric:bootstrap` 已在修复后真实通过。

### 5.4 Docker socket 被转换成 Git 安装目录

Git Bash 将 `/var/run/docker.sock` 转换成：

`C:\Program Files\Git\var\run\docker.sock`

节点容器因此创建失败。

精确处理：

```bash
export MSYS2_ENV_CONV_EXCL='DOCKER_SOCK'
```

不要改回全局 `MSYS_NO_PATHCONV=1` 或 `MSYS2_ARG_CONV_EXCL='*'`。全局禁止转换会让 Windows Fabric CLI 收到 `/c/...`，进而错误拼成 `C:\c\...`。

### 5.5 官方测试网络缺少 jq

Git for Windows 默认不包含 jq，官方 `configUpdate.sh` 在设置锚节点时退出。

处理：

- `network/ensure-jq.ps1` 下载 jq 1.8.1 Windows AMD64 单文件
- 固定校验 SHA-256：`23cb60a1354eed6bcc8d9b9735e8c7b388cd1fdcb75726b93bc299ef22dd9334`
- 二进制保存在被 Git 忽略的 `network/bin`，不修改系统 PATH

### 5.6 Node 链码构建镜像缺失

peer 首次安装 Node 链码时自动拉取 `hyperledger/fabric-nodeenv:2.5`，Docker Hub 返回 EOF。

处理：

- bootstrap 和启动脚本在部署前检查该镜像
- 缺失时显式拉取并验证命令状态

### 5.7 链码 lockfile 引用了 monorepo 外部目录

在带 pnpm junction 的源码目录运行 npm，生成的 lockfile 指向 `../../node_modules/.pnpm/...`。Fabric 独立构建容器中没有这些路径，链码容器因 `fabric-chaincode-node: not found` 以 127 退出。

处理：

- 在无 `node_modules` 的独立目录解析生产依赖
- 提交 standalone `chaincode/logistics/package-lock.json`
- 验收确认 lockfile 中不存在 `../node_modules` 外部引用

### 5.8 Fabric 环境文件包含 BOM

Windows PowerShell 的 `Set-Content -Encoding utf8` 生成 UTF-8 BOM，Node `loadEnvFile()` 将首个键识别为带隐藏字符的 `LEDGER_MODE`，API 因而回退到 demo。

处理：

- `write-env.ps1` 使用无 BOM UTF-8 写入
- `loadConfig()` 在使用真实进程环境时读取 `ENV_FILE`
- 前台配置探针和 API 日志均确认 `ledger=fabric`

## 6. 真实写入验收结果

2026-07-28 已完成：

- `pnpm fabric:up` 完整通过
- `logisticschannel` 创建成功，Org1、Org2 peer 均加入
- `logistics` 1.0、sequence 1 在双组织安装、批准并提交
- `/api/network` 返回 `mode=fabric`、`health.status=ok`
- 发货方创建全新运单，承运方成功接单
- API 重启后仍可读取同一运单、两条历史和公开追踪结果

验收对象：

- 运单 ID：`shipment-437e1126-c7f0-4cf6-9b37-3c1c9996a177`
- 运单号：`JX20260728008518`
- 建单交易：`6fb2379e3d75cf22d7f9895e862269e6a893cbef1fd4631051fc51d7fb6fbd5e`
- 接单交易：`03064fff127c631c10de72c9e2c0934e0ac8605374d320efc093c4185b90d008`
- 重启后状态：`ACCEPTED`
- 重启后历史：2 条

回归结果：

- 全工作区测试通过：chaincode 11、API 3、Web 7，共 21 项
- `pnpm typecheck` 通过
- `pnpm build` 通过
- 本轮可格式化文件通过 Prettier
- `git diff --check` 通过
- Git 跟踪的 Fabric 环境文件、证书和私钥数量为 0

## 7. 复现操作

### 第一步：确认仍在独立分支

```powershell
git switch codex/fabric-live-ledger
git status --short
```

### 第二步：由启动脚本自动重建残缺产物

直接运行下一步的 `pnpm fabric:up`。启动脚本会先检查关键证书；若身份材料残缺，只会处理 `network/fabric-samples/test-network` 内的六个可再生目录。

以下 PowerShell 片段只保留为启动脚本执行前的人工兜底，不应扩大删除范围：

```powershell
$testRoot = [IO.Path]::GetFullPath(
  (Resolve-Path ".\network\fabric-samples\test-network").Path
)

$targets = @(
  "organizations\peerOrganizations",
  "organizations\ordererOrganizations",
  "organizations\fabric-ca\org1",
  "organizations\fabric-ca\org2",
  "organizations\fabric-ca\ordererOrg",
  "channel-artifacts"
) | ForEach-Object {
  [IO.Path]::GetFullPath((Join-Path $testRoot $_))
}

foreach ($target in $targets) {
  if (-not $target.StartsWith(
      "$testRoot\",
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw "Unsafe cleanup target: $target"
  }

  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}
```

不要删除整个 `organizations`，其中还有官方跟踪的配置和 `registerEnroll.sh`。

### 第三步：重新启动网络

```powershell
pnpm fabric:up
```

成功条件：

- Org1、Org2、orderer、两个 CouchDB 正常运行
- 三个 CA 在首次或身份重建时完成签发；缓存身份启动时不要求常驻
- `logisticschannel` 创建成功
- Org1、Org2 peer 均加入通道
- `logistics` TypeScript 链码部署成功
- 生成 `apps/api/.env.fabric`

### 第四步：使用 Fabric 模式启动系统

```powershell
$env:ENV_FILE = (Resolve-Path ".\apps\api\.env.fabric").Path
$env:JWT_SECRET = "$([guid]::NewGuid())$([guid]::NewGuid())"
pnpm dev
```

先验证网络状态：

```powershell
Invoke-RestMethod "http://127.0.0.1:3001/api/network"
```

必须满足：

- `mode` 为 `fabric`
- `health.status` 为 `ok`
- channel 为 `logisticschannel`
- chaincode 为 `logistics`

### 第五步：完成一笔真实写入验收

本轮已全部完成；后续复验至少包括：

1. 发货方登录并创建一张全新运单。
2. 保存响应中的 Fabric `transactionId`。
3. 使用承运方账户接单。
4. 读取运单详情与历史，确认交易记录来自 Fabric。
5. 重启 API 后再次读取该运单，确认数据仍存在于链上。
6. 检查页面不再显示“本地演示保存”。

在以上步骤全部通过前，不要删除演示账本适配器，也不要把 UI 文案永久改成“真实上链”。建议保留 `LEDGER_MODE` 作为开发和测试开关，但实际运行默认切换到 Fabric 配置。

## 8. 提交边界

完成真实写入验证后：

1. 运行网络脚本自检、API 测试、类型检查和构建。
2. 检查 `.env.fabric`、证书和私钥没有进入 Git。
3. 只提交脚本、文档和必要代码。
4. 推送 `codex/fabric-live-ledger` 供用户审核。
5. 未经审核不要合并到 `main`。
