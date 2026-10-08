# Lightsail Panel

[![Docker CI](https://github.com/haoch1/lightsail-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/haoch1/lightsail-panel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Lightsail Panel 是面向 Amazon Lightsail 的自托管管理面板，提供中文界面、多账户管理、跨区域资源查询、实例管理、静态 IP、防火墙和流量统计。

应用采用 React、TypeScript 和 Node.js 24，使用 AWS SDK for JavaScript v3 调用 Lightsail 与 STS API。账户凭证以 AES-256-GCM 加密保存，应用数据持久化至 SQLite。

## 功能

| 模块     | 功能                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------- |
| 实例管理 | 跨账户、跨区域查询；名称与 IP 搜索；状态筛选；批量启动与停止；重启、删除、IPv6 切换和公网 IP 更换    |
| 实例信息 | 系统、规格、套餐月价、公网与私网地址、本月流量，以及上行与下行明细                                   |
| 实例创建 | Debian、Ubuntu、CentOS 系统镜像；通用型套餐；双栈与仅 IPv6 网络；可用区选择；默认 SSH 密钥与启动脚本 |
| 静态 IP  | 按账户与区域分配地址；绑定、解绑和释放；禁止直接释放已绑定地址                                       |
| 防火墙   | TCP、UDP、ICMP 与所有协议规则；单端口和端口范围；IPv4、IPv6 与 CIDR 来源限制                         |
| 流量统计 | 本月、今日、近 7 天、近 30 天；入站、出站与合计流量；按日汇总                                        |
| 账户管理 | Access Key ID 与 Secret Access Key 身份验证、加密保存、重新验证和移除                                |
| 操作日志 | 记录资源操作、执行结果与错误信息                                                                     |

区域范围与账户筛选独立设置，默认显示全部区域和全部账户。资源查询采用 5 分钟缓存，支持到期自动更新和手动刷新；缓存有效期内刷新网页不触发重复扫描。自动更新在页面打开期间执行。

## Docker 部署

官方镜像发布至 [GitHub Container Registry（GHCR）](https://github.com/haoch1/lightsail-panel/pkgs/container/lightsail-panel)：`ghcr.io/haoch1/lightsail-panel:latest`。支持 `linux/amd64` 与 `linux/arm64`，Docker 根据服务器架构选择对应镜像。服务器仅需拉取镜像并启动容器，无需安装 Node.js、pnpm 或执行源码构建。

### 1. 准备环境

服务器需要安装 Docker Engine、Docker Compose v2 和 curl，并能够访问 GitHub、GHCR 以及 AWS API。公开镜像可直接拉取，无需登录 GitHub。

```bash
docker --version
docker compose version
curl --version
```

### 2. 下载部署配置

```bash
mkdir -p lightsail-panel
cd lightsail-panel
curl -fsSLo compose.yaml https://raw.githubusercontent.com/haoch1/lightsail-panel/main/compose.yaml
curl -fsSLo .env.example https://raw.githubusercontent.com/haoch1/lightsail-panel/main/.env.example
cp .env.example .env
```

默认配置将面板发布至服务器本机的 `127.0.0.1:8090`。需要更换端口时，修改 `.env` 中的 `PANEL_PORT`。使用 HTTPS 反向代理时，同时设置 `PUBLIC_ORIGIN`。

```dotenv
PANEL_IMAGE=ghcr.io/haoch1/lightsail-panel:latest
PANEL_BIND=127.0.0.1
PANEL_PORT=8090
# 使用反向代理时填写浏览器访问的完整来源，不包含路径或末尾斜杠。
# PUBLIC_ORIGIN=https://panel.example.com
```

### 3. 拉取镜像并启动

```bash
docker compose pull
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8090/api/health
```

健康检查返回示例：

```json
{ "ok": true, "version": "1.6.0", "service": "lightsail" }
```

镜像在 GitHub Actions 中完成依赖安装、类型检查、自动化测试、前端构建及两种架构的容器启动验证后发布。运行容器使用非 root 用户，默认启用 `no-new-privileges` 并移除 Linux capabilities。

在服务器本机访问 `http://127.0.0.1:8090`。从另一台计算机连接时，可使用 SSH 本地端口转发：

```bash
ssh -N -L 8090:127.0.0.1:8090 user@server
```

随后在本地浏览器访问 `http://127.0.0.1:8090`。长期远程访问建议使用下文的 HTTPS 反向代理。

### 4. 初始化管理员

首次访问时设置管理员密码，长度至少为 12 个字符。应用不包含预设管理员密码。

登录后，点击顶部的 **管理**，进入 AWS 账户管理。主题切换位于侧栏底部，支持浅色、暗色和跟随系统。

### 5. 配置 IAM 并添加 AWS 账户

1. 在 AWS IAM 控制台创建用于面板的 IAM 用户。
2. 在权限配置中创建自定义策略，切换至 JSON 编辑器，粘贴 [docs/iam-policy.json](docs/iam-policy.json) 的完整内容。
3. 将该策略附加到上述 IAM 用户。
4. 在用户的 **安全凭证** 页面创建访问密钥，保存 Access Key ID 与 Secret Access Key。
5. 在面板的账户管理中点击 **添加 AWS 账户**，填写账户名称、Access Key ID 和 Secret Access Key。
6. 点击 **验证并保存**。应用通过 STS 验证身份，成功后加密保存凭证并查询资源。

添加账户无需选择默认区域。实例创建和静态 IP 分配时，需要分别选择目标区域。AWS API 请求由面板服务器直接发送。

策略覆盖当前面板使用的 Lightsail API。完整权限说明见 [docs/PERMISSIONS.md](docs/PERMISSIONS.md)。区域是否可用、资源配额、镜像与套餐以 AWS 返回结果为准。

## HTTPS 反向代理

以下示例适用于 Nginx 与面板运行在同一台服务器的情况。首先配置域名解析和 TLS 证书，然后修改 `.env`：

```dotenv
PUBLIC_ORIGIN=https://panel.example.com
```

应用配置后重新创建容器：

```bash
docker compose up -d
```

Nginx 配置示例，需要替换域名和证书路径：

```nginx
server {
    listen 80;
    server_name panel.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name panel.example.com;
    ssl_certificate /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

`PUBLIC_ORIGIN` 必须与浏览器实际访问的协议、域名和端口一致。使用 HTTPS 来源时，登录 Cookie 启用 `Secure` 属性。

## 配置参数

| 变量             | 默认值                                  | 说明                                                                    |
| ---------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `PANEL_IMAGE`    | `ghcr.io/haoch1/lightsail-panel:latest` | 要部署的镜像；支持版本标签、提交标签或 `@sha256:...` 摘要               |
| `PANEL_BIND`     | `127.0.0.1`                             | Compose 在宿主机绑定的地址                                              |
| `PANEL_PORT`     | `8090`                                  | Compose 在宿主机发布的端口                                              |
| `PUBLIC_ORIGIN`  | 空                                      | 浏览器访问来源；HTTPS 反向代理时设置                                    |
| `ENCRYPTION_KEY` | 自动生成                                | 可选的 32 字节 Base64 加密密钥；未配置时写入数据卷中的 `encryption.key` |

容器内部固定使用 `HOST=0.0.0.0`、`PORT=4180`、`DATA_DIR=/app/data`。Compose 项目名为 `lightsail-panel`，持久化卷名为 `lightsail-panel_panel-data`。

## 数据备份与恢复

数据卷包含 SQLite 数据库、管理员配置、AWS 账户加密凭证、操作日志和 `encryption.key`。恢复时必须保留数据库及其对应的加密密钥；若通过环境变量提供密钥，还需单独保存该变量。

以下命令适用于 Linux 宿主机。备份前停止服务，以保持数据库一致性：

```bash
mkdir -p backups
docker compose stop panel
docker run --rm \
  -v lightsail-panel_panel-data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine:3.22 tar -czf /backup/panel-data.tar.gz -C /data .
docker compose start panel
```

恢复到空的数据卷：

```bash
docker compose stop panel
docker volume create lightsail-panel_panel-data
docker run --rm \
  -v lightsail-panel_panel-data:/data \
  -v "$PWD/backups:/backup:ro" \
  alpine:3.22 sh -c 'tar -xzf /backup/panel-data.tar.gz -C /data && chown -R 1000:1000 /data'
docker compose up -d
```

恢复命令仅用于空卷；替换现有数据前应先完成备份。`docker compose down` 保留数据卷，`docker compose down -v` 会删除持久化数据。

## 更新与维护

升级前备份数据，再执行：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

`latest` 在 `main` 分支构建与测试成功后更新。每次发布同时提供 `sha-<完整提交 SHA>` 标签；推送 `vX.Y.Z` Git 标签时，额外发布 `vX.Y.Z` 与 `X.Y.Z` 镜像标签。需要固定版本或回滚时，在 [镜像页面](https://github.com/haoch1/lightsail-panel/pkgs/container/lightsail-panel) 选择已发布的标签或摘要，修改 `.env` 中的 `PANEL_IMAGE`，然后重新执行上述命令。重新创建容器不会删除持久化数据卷。

从此前的源码构建部署迁移时，在原项目目录执行以下命令；保留现有 `.env` 和数据卷：

```bash
git pull --ff-only
docker compose pull
docker compose up -d
```

常用维护命令：

```bash
docker compose logs -f --tail=100 panel
docker compose restart panel
docker compose stop panel
docker compose down
```

### 常见问题

| 问题                        | 处理方法                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| 浏览器无法访问              | 确认容器正常运行、宿主机端口未被占用，以及端口转发或反向代理配置正确。默认端口仅监听服务器本机。 |
| 无法拉取镜像                | 确认服务器能够连接 `ghcr.io`，并核对 `PANEL_IMAGE` 中的仓库地址和标签。默认公开镜像不需要登录。  |
| 请求来源不被允许            | 检查 `PUBLIC_ORIGIN` 是否与浏览器访问来源完全一致，修改后执行 `docker compose up -d`。           |
| AWS 身份验证失败            | 检查两项密钥是否来自同一 IAM 用户、访问密钥是否启用，以及服务器是否能够访问 AWS STS。            |
| 查询或操作提示 AccessDenied | 将当前 [IAM 策略](docs/iam-policy.json) 附加至对应用户，并核对组织策略、权限边界和显式拒绝规则。 |
| 创建区域不可用              | 在 AWS 中确认目标区域已启用、Lightsail 可用且配额充足。                                          |
| 保存凭证无法解密            | 恢复与数据库匹配的 `encryption.key` 或 `ENCRYPTION_KEY`。                                        |
| 页面资源加载失败            | 刷新页面以加载最新构建资源，并确认反向代理未长期缓存 HTML。                                      |

## 使用说明

- 实例价格为 AWS 套餐月价，不代表实时账单。停止实例后，AWS 仍可能继续收取套餐费用。
- 流量来源为 Lightsail 的 `NetworkIn` 与 `NetworkOut`，采用 `Sum / Bytes`，截至最近完成的整点。所有时间范围从浏览器本地日期零点起算；近 7 天与近 30 天均包含今日。
- 流量涵盖全部网卡，不能直接作为 AWS 收费出站流量或套餐剩余额度。指标缺失与接口失败保持未知，不填充虚构数值。
- 创建实例仅使用默认 SSH 密钥，支持下载 `.pem` 私钥。默认密钥按账户与区域管理，私钥不保存至应用数据库或日志。
- 启动脚本在实例创建时执行。默认脚本包含密码占位符，提交前应替换为实际配置或清空脚本。
- 未绑定的静态 IP 可能产生 AWS 费用。释放地址后，不保证能够再次获取相同地址。
- 演示入口为 `/lightsail?demo=1`，使用浏览器内存中的示例数据，不调用 AWS API。

## 开发与验证

开发环境需要 Node.js 24 和 pnpm 11.25.0：

```bash
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

开发界面为 `http://127.0.0.1:4173`，API 为 `http://127.0.0.1:4180`。

```bash
pnpm check
pnpm test
pnpm build
```

需要自行构建镜像时，在源码目录执行：

```bash
docker build -t lightsail-panel:local .
PANEL_IMAGE=lightsail-panel:local docker compose up -d --pull never
```

GitHub Actions 在 amd64 与 arm64 原生 runner 上分别构建并验证 Docker 镜像，全部通过后发布多架构镜像至 GHCR；Pull Request 仅执行构建与测试，不发布镜像。发布后还会通过 Compose 拉取镜像并验证启动。代码结构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 许可证

[MIT License](LICENSE)
