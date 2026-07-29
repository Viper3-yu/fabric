# Fabric 本地测试网络

本目录调用 Hyperledger Fabric 官方 `fabric-samples/test-network`，用于课程开发和本机验收，不是生产网络模板。

## 前置条件

- Docker Desktop 已安装并运行
- Git for Windows 自带的 Git Bash 可用
- Go 1.23+、Node.js 20+ 和 pnpm 可用

## 启动

```powershell
pnpm fabric:bootstrap
pnpm fabric:up
```

`fabric:bootstrap` 使用官方安装脚本下载 Fabric 2.5 LTS 的 Docker 镜像、CLI 二进制和 samples。`fabric:up` 创建 `logisticschannel`，启动 Org1、Org2、orderer、CA 和 CouchDB，随后部署本项目 `logistics` Go 链码。

脚本结束后会生成 `apps/api/.env.fabric`。将其中变量和应用密钥一起载入，再启动 API。

## 停止

```powershell
pnpm fabric:down
```

## 说明

测试网络只有单 orderer，适合教学和验收，不应直接部署到生产环境。真实生产网络还需要多 orderer、高可用 CA、TLS 管理、密钥托管、监控和备份策略。
