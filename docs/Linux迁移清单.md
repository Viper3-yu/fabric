# Linux 迁移清单

盘点全部代码的平台绑定现状，以及把项目从 Windows 完整迁到 Linux 还需要做的事。结论：代码主体已跨平台（CI 三个 job 本就跑在 ubuntu-latest 上），代码层面只剩视觉回归基线一项；其余是新机器的环境搭建与数据初始化，照既有文档执行即可。

部署形态参考：单机虚拟机见 [Ubuntu虚拟机部署指南](Ubuntu虚拟机部署指南.md)，多机生产拓扑见 [deploy/README.md](../deploy/README.md)。

## 1. 代码平台绑定盘点（按模块）

### 根脚本与工具链

| 项目                                           | Linux 状态 | 说明                                                                                                  |
| ---------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `package.json` 全部脚本                        | ✅ 可用    | `doctor` 原本仅 Windows，现已并入 `run-platform.js` 分发                                              |
| `scripts/run-platform.js`                      | ✅         | 六个任务（doctor、fabric:bootstrap/up/down、test:fabric、check-go-format）按平台选择 ps1 / sh         |
| `scripts/doctor.sh`                            | ✅（新增） | 检查 Go 1.23+ / Node 20.12+ / pnpm 11+ / Git（必需）与 Docker（可选），必需项缺失或版本过低时退出码 1 |
| `scripts/test-fabric.sh`、`check-go-format.sh` | ✅         | 原有                                                                                                  |
| prettier / gofmt                               | ✅         | `endOfLine: auto` + `.gitattributes`，行尾不区分平台                                                  |

### Fabric 网络（network/）

| 脚本                                             | Linux 状态       | 说明                                                                                                    |
| ------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------- |
| `bootstrap.sh`                                   | ✅（本次修复）   | 补了 `chmod +x install-fabric.sh`：curl 下载的文件不带执行位，原样在 Linux 上会 Permission denied       |
| `up.sh`                                          | ✅（依赖已修复） | 依次执行 `start-fabric.sh` 和 `write-env.sh`；`start-fabric.sh` 在 git 中原为 644，已补 755 执行位      |
| `start-fabric.sh`                                | ✅               | cygpath/短路径逻辑均有 `command -v` 守卫，Linux 上自然跳过；`GOPROXY` 默认 goproxy.cn，可用环境变量覆盖 |
| `write-env.sh`、`stop-fabric.sh`                 | ✅               | 原有；`write-env.sh` 生成随机 `JWT_SECRET` 并保留已有 `APP_PASSWORD*` 行                                |
| `*.ps1`、`resolve-git-bash.ps1`、`ensure-jq.ps1` | 不参与           | Windows 专用包装，Linux 不会被调用，按现状设计保留共存                                                  |

### 应用代码

| 模块                                | Linux 状态  | 说明                                                                 |
| ----------------------------------- | ----------- | -------------------------------------------------------------------- |
| `apps/api`（Go）                    | ✅          | 无 `GOOS` 分支、无硬编码 Windows 路径、无服务端字体/PDF 依赖         |
| `chaincode/logistics`（Go）         | ✅          | 在 `fabric-ccenv` 容器内构建，与宿主 OS 无关                         |
| `apps/web`、`packages/shared`（TS） | ✅          | `vite --host 0.0.0.0`；⚠️ Playwright 截图基线仅 `win32`（见第 3 节） |
| 西文字体 Times New Roman / 思源黑体 | ✅ 不受影响 | 均为浏览器端渲染，与服务器 OS 无关                                   |

### 工程设施

| 项目                             | Linux 状态 | 说明                                                                                                   |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `.gitattributes`                 | ✅         | `* text=auto`、`*.sh text eol=lf`、`*.svg eol=lf`                                                      |
| CI（`.github/workflows/ci.yml`） | ✅         | web 构建/测试、Go 构建/vet/测试、Playwright 三个 job 全部 `ubuntu-latest`，主链路每天在 Linux 上被验证 |

## 2. 本次已完成的代码修复

1. **`pnpm doctor` 双平台化**：新增 `scripts/doctor.sh`（doctor.ps1 的对等实现），`run-platform.js` 与根 `package.json` 改为经 `run-platform.js` 分发。
2. **`network/start-fabric.sh` 补可执行位**：git 模式 644 → 755。`up.sh` 直接执行它，克隆到 Linux 后原状会 Permission denied。
3. **`network/bootstrap.sh` 给下载的 `install-fabric.sh` 加 `chmod +x`**：curl 下载的文件不带执行位，全新 Linux 环境 bootstrap 会失败。
4. **README** 环境要求与说明更新为双平台表述。

## 3. 剩余代码待办

- [ ] **Linux 视觉回归基线**：`apps/web/e2e/__screenshots__/` 现只有 `win32/`（截图按平台分，字体渲染不同）。在 Linux 机器上执行 `pnpm --filter @jixin/web visual:update`，提交生成的 `e2e/__screenshots__/linux/`。CI 已兼容基线缺失的状态（跳过并提示），不阻塞部署；仅当需要在 Linux 上本地跑 `visual:check` 时必须。

## 4. 新 Linux 机器环境搭建

详细步骤见 [Ubuntu虚拟机部署指南](Ubuntu虚拟机部署指南.md) 第 1–2 节，要点：

```bash
sudo apt update && sudo apt install -y git curl jq build-essential ca-certificates openssl
# Docker Engine + compose v2（get.docker.com 脚本），并 enable --now、加 docker 组
# Go 1.23+（/usr/local/go）、Node.js 22 + corepack enable（自动用上 pnpm@11.9.0）
```

- 虚拟机规格：4 vCPU、内存 ≥6 GB（Fabric 7 容器 + CouchDB）、磁盘 ≥40 GB。
- 代码获取：虚拟机能连 GitHub 就 `git clone`（私有库配 SSH key；连不上参考 SSH over 443），否则 Windows 打包排除 `node_modules`/`network/fabric-samples`/`tmp`/`apps/api/.env.fabric` 后 scp（指南第 2 节有现成命令）。
- 拉取依赖：`pnpm install --frozen-lockfile`。

## 5. Fabric 网络与数据初始化

```bash
pnpm fabric:bootstrap   # 下载 Fabric 2.5.16 / CA 1.5.15 二进制、镜像、fabric-samples
pnpm fabric:up          # 起双组织网络 + CouchDB，部署链码，生成 apps/api/.env.fabric
```

- **`.env.fabric` 必须在 Linux 上重新生成**，禁止从 Windows 拷贝：证书 keystore 是本机随机生成的。
- `fabric:up` 自动写入随机 `JWT_SECRET`；四个账户密码需重新设置：`go run ./apps/api/cmd/hash-password '密码'` 生成 bcrypt 哈希，以 `APP_PASSWORD_HASH_<账号>` 追加到 `.env.fabric`（重跑 fabric:up 不会抹掉这些行）。
- 新账本是空的，幂等写入预置运单：`ENV_FILE=$PWD/apps/api/.env.fabric pnpm seed`（12 个运单，覆盖全部状态）。

## 6. 启动与部署形态

| 场景     | 命令/方式                                                                            |
| -------- | ------------------------------------------------------------------------------------ |
| 开发     | `ENV_FILE=$PWD/apps/api/.env.fabric pnpm dev`（对应 Windows 的 `$env:ENV_FILE=...`） |
| 常驻 API | systemd `EnvironmentFile=` 指向 `.env.fabric`，权限 600（deploy/README.md 有模板）   |
| 前端     | Nginx 托管 `apps/web/dist` 并反代 `/api`                                             |

生产化注意（指南与 deploy/README.md 已述）：局域网 IP + HTTP 下不要开 `NODE_ENV=production`（Secure cookie 会静默断登录）；Nginx 反代后设 `TRUST_PROXY=true`；分域部署时 `CORS_ORIGIN` 显式列出前端 Origin（禁 `*`）。

## 7. 迁移后冒烟验证序列

```bash
pnpm doctor            # 工具链自检
docker ps              # daemon 可达
pnpm fabric:up         # 网络就绪、.env.fabric 生成
ENV_FILE=$PWD/apps/api/.env.fabric pnpm dev   # 起 API + 前端
pnpm seed              # 预置运单
pnpm test:fabric       # 集成冒烟
pnpm test && pnpm lint && pnpm format:check   # 全量校验
```

浏览器访问工作台，四账户登录、运单状态流转、公开查询各过一遍。

## 8. 平台差异与坑速查

| Windows 上的坑                              | Linux 上的变化                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Docker Desktop 不自启                       | `sudo systemctl enable --now docker` 后不复存在                                                            |
| `go run` 子进程残留占端口（假 401）         | 同样可能发生：`ss -ltnp \| grep <端口>` 找 PID 后 `kill`                                                   |
| `fabric:up` 重生成 `.env.fabric` 抹掉密码行 | 已修复：`write-env.sh`/`write-env.ps1` 均保留 `APP_PASSWORD*` 行                                           |
| GitHub 直连不通                             | 若虚拟机网络同样受限，配 SSH over 443（`url.ssh://git@ssh.github.com:443/.insteadOf=https://github.com/`） |

其他：`start-fabric.sh` 默认 `GOPROXY=goproxy.cn`（可环境变量覆盖，海外服务器可改回官方源）；Fabric 对内存敏感，虚拟机不要低于 6 GB；git 执行位依赖索引中 755 标记（本次已修，Windows 上 `core.filemode` 默认关闭不影响）。
