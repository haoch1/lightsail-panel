# Lightsail Panel

[![Docker CI](https://github.com/haoch1/lightsail-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/haoch1/lightsail-panel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Lightsail Panel 是面向 Amazon Lightsail 的自托管管理面板，提供中文界面、多账户管理、跨区域资源查询、实例管理、静态 IP、防火墙和流量统计。

应用采用 React、TypeScript 和 Node.js 24，使用 AWS SDK for JavaScript v3 调用 Lightsail 与 STS API。账户凭证以 AES-256-GCM 加密保存，应用数据持久化至 SQLite。

## 目录

- [功能](#功能)
- [Docker 部署](#docker-部署)
- [获取 Access Key 与配置 IAM](#获取-access-key-与配置-iam)
- [面板使用流程](#面板使用流程)
- [HTTPS 反向代理](#https-反向代理)
- [配置参数](#配置参数)
- [数据备份与恢复](#数据备份与恢复)
- [更新与维护](#更新与维护)
- [常见问题](#常见问题)
- [使用说明](#使用说明)
- [开发与验证](#开发与验证)

## 功能

| 模块     | 功能                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 实例管理 | 跨账户、跨区域查询；名称与 IP 搜索；状态筛选；批量启动与停止；重启、删除、IPv6 切换和公网 IP 更换                                           |
| 实例信息 | 系统、规格、套餐月价、公网与私网地址、本月流量，以及上行与下行明细                                                                          |
| 实例创建 | Debian、Ubuntu、CentOS 系统镜像；通用型套餐；双栈与仅 IPv6 网络；可用区选择；默认 SSH 密钥与启动脚本；可选防火墙规则及自动分配、绑定静态 IP |
| 静态 IP  | 按账户与区域分配地址；绑定、解绑和释放；禁止直接释放已绑定地址                                                                              |
| 防火墙   | TCP、UDP、ICMP 与所有协议规则；单端口和端口范围；IPv4、IPv6 与 CIDR 来源限制                                                                |
| 流量统计 | 本月、今日、近 7 天、近 30 天；入站、出站与合计流量；按日汇总                                                                               |
| 账户管理 | Access Key ID 与 Secret Access Key 身份验证、加密保存、重新验证和移除                                                                       |
| 操作日志 | 记录资源操作、执行结果与错误信息                                                                                                            |

区域范围与账户筛选独立设置，默认显示全部区域和全部账户。资源查询采用 5 分钟缓存，支持到期自动更新和手动刷新；缓存有效期内刷新网页不触发重复扫描。操作提交后单独跟踪目标资源，完成时自动更新对应账户与区域。

## Docker 部署

官方镜像发布至 [GitHub Container Registry（GHCR）](https://github.com/haoch1/lightsail-panel/pkgs/container/lightsail-panel)：`ghcr.io/haoch1/lightsail-panel:latest`。支持 `linux/amd64` 与 `linux/arm64`，Docker 根据服务器架构选择对应镜像。服务器仅需拉取镜像并启动容器，无需安装 Node.js、pnpm 或执行源码构建。

### 1. 准备环境

服务器需要安装 Docker Engine、Docker Compose v2 和 curl，并能够访问 GitHub、GHCR 以及 AWS API。公开镜像可直接拉取，无需登录 GitHub。

Docker 安装方式见 [Docker Engine 官方安装文档](https://docs.docker.com/engine/install/)。以下命令在 Linux 服务器的终端中执行。当前用户需要具备运行 Docker 的权限；未配置权限时，在 Docker 命令前添加 `sudo`。

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

使用 `nano .env` 或其他文本编辑器修改配置；`.env.example` 是模板，Compose 实际读取的是同目录的 `.env`。AWS Access Key 在面板中添加，无需写入该文件。

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

需要直接通过服务器 IP 访问时，将 `.env` 的 `PANEL_BIND` 改为 `0.0.0.0`，执行 `docker compose up -d`，并在服务器防火墙及云平台安全规则中允许指定来源访问 TCP `8090`。访问地址为 `http://服务器IP:8090`；通过公网管理 AWS 凭证应使用 HTTPS。修改宿主机端口不会改变容器内部的 `4180` 端口。

### 4. 初始化管理员

首次访问时设置管理员密码，长度至少为 12 个字符。应用不包含预设管理员密码。

登录后，点击顶部的 **AWS 账户管理**，进入账户管理界面。主题切换位于侧栏底部，支持浅色、暗色和跟随系统。

### 5. 配置 IAM 并添加 AWS 账户

按照下一节完成 IAM 权限和 Access Key 配置，再通过顶部 **AWS 账户管理 → 添加 AWS 账户** 接入面板。已有专用 IAM 用户时，可直接执行策略配置和密钥创建步骤。

## 获取 Access Key 与配置 IAM

面板使用一对 **Access Key ID** 与 **Secret Access Key** 调用 AWS API，不使用 AWS 控制台登录密码。新账户表单接收长期 Access Key，不提供需要 Session Token 的临时凭证输入。推荐为本面板创建专用 IAM 用户，并仅附加本项目提供的权限策略。

### 方式一：专用 IAM 用户（推荐）

#### 1. 创建 IAM 用户

1. 使用具有 IAM 管理权限的身份登录 [AWS IAM 控制台](https://console.aws.amazon.com/iam/)。
2. 打开 **Users（用户）→ Create user（创建用户）**。
3. 填写用户名，例如 `lightsail-panel`。该用户仅供面板调用 API，无需开启 AWS Management Console 登录权限。
4. 完成用户创建。若已有专用用户，打开该用户的详情页。

IAM 用户、控制台访问和权限配置的关系见 [AWS 创建 IAM 用户说明](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html)。

#### 2. 创建并附加统一权限策略

1. 打开 **Policies（策略）→ Create policy（创建策略）**。
2. 在 **Policy editor（策略编辑器）** 中选择 **JSON**。
3. 打开本仓库的 [docs/iam-policy.json](docs/iam-policy.json)，复制完整 JSON，替换编辑器中的内容。
4. 检查策略内容并点击 **Next（下一步）**，填写策略名称，例如 `LightsailPanelPolicy`，然后创建策略。
5. 返回 **Users → lightsail-panel → Permissions（权限）**。
6. 选择 **Add permissions（添加权限）→ Attach policies directly（直接附加策略）**，搜索并勾选 `LightsailPanelPolicy`，完成添加。

只需这一份策略。它覆盖面板的实例、静态 IP、防火墙、流量查询和默认密钥下载，不授予账单、快照与备份管理权限；详细说明见 [权限文档](docs/PERMISSIONS.md)。自定义策略编辑流程见 [AWS JSON 策略编辑器说明](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_create-console.html)。

已有旧版策略时，更新其 JSON 为仓库当前版本。创建时设置防火墙需要新增的 `lightsail:PutInstancePublicPorts` 权限；仅重新创建 Access Key 不会更新用户权限。

#### 3. 创建 Access Key

1. 在该 IAM 用户详情页选择 **Security credentials（安全凭证）**。
2. 找到 **Access keys（访问密钥）**，点击 **Create access key（创建访问密钥）**。
3. 在用途页面选择 **Other（其他）**，继续下一步。可填写用途描述 `Lightsail Panel`。
4. 创建后保存 **Access Key ID** 与 **Secret Access Key**，或下载 CSV。
5. 保存完成后关闭页面。Secret Access Key 只在创建时显示；遗失后应创建新密钥，而不是尝试找回。

每个 IAM 用户最多拥有两对 Access Key，创建入口不可用时需处理现有密钥。步骤及密钥启用、停用说明见 [AWS Access Key 管理文档](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-key-self-managed.html)。

### 方式二：Root user 的 Access Key（补充说明）

[Access Key 获取图文教程](https://www.hidandelion.com.cn/how-to-get-aws-access-key-for-slauncher-pro/) 介绍了此路径。Root user 密钥具备账户级权限，不能通过给 IAM 用户附加本项目策略来限制它；[AWS 官方建议避免创建 Root user Access Key](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user_manage_add-key.html)。通常应采用上面的 IAM 用户方式。

需要了解该入口时，可按以下顺序操作：

1. 在 AWS 登录页面选择 **Root user**，使用 AWS 账户邮箱和密码登录，按提示完成 MFA。
2. 点击控制台右上角账户名称或账户编号，选择 **Security credentials（安全凭证）**。
3. 在 **Access keys** 区域点击 **Create access key**。
4. 阅读 **Alternatives to root user access keys** 页面中的说明；决定继续时，勾选确认项并创建。
5. 在 **Retrieve access key** 页面保存 Access Key ID 与 Secret Access Key，或下载 CSV。

该方法无需创建 IAM 用户或附加 IAM 用户策略。若已持有 Root user 密钥，建议先将面板迁移到专用 IAM 用户并验证资源访问，再停用旧密钥。

### 将凭证添加到面板

1. 登录 Lightsail Panel，点击右上角 **AWS 账户管理**。
2. 选择 **添加 AWS 账户**，填写以下三项：

   | 字段              | 内容                                              |
   | ----------------- | ------------------------------------------------- |
   | 账户名称          | 面板中的显示名称，例如 `生产环境`；由用户自行填写 |
   | Access Key ID     | 与 Secret Access Key 配对的访问密钥标识           |
   | Secret Access Key | 创建访问密钥时保存的密钥内容                      |

3. 点击 **验证并保存**。应用通过 `STS GetCallerIdentity` 验证身份，成功后加密保存凭证。
4. 返回实例列表，选择全部账户、全部区域，或指定账户与区域查询资源。身份验证成功仅表示凭证有效，资源操作仍取决于 IAM 权限、区域状态与配额。

添加账户无需选择默认区域。实例创建和静态 IP 分配时，需要分别选择目标区域。AWS API 请求由面板服务器直接发送。

密钥和下载的 CSV 不应写入 README、Compose、Git 仓库或操作日志。面板从数据库读取加密凭证；备份时须同时保留其加密密钥。移除面板账户只删除本地保存的凭证，不会停用 AWS 中的 Access Key，也不会删除云资源。需要撤销访问时，在 AWS 对应用户的 **Security credentials → Access keys** 中停用或删除该密钥。

## 面板使用流程

### 查询与管理实例

顶部 **区域范围** 和 **账户** 默认显示 **全部区域** 与 **全部账户**，仅在手动选择时改变筛选范围。创建实例、分配静态 IP 及其他资源操作不会修改顶部选择。实例列表可按名称、IP 和状态筛选，展示规格、套餐价格、本月流量和网络地址。将鼠标移至本月流量可查看上行与下行数据；点击流量数值打开该实例的流量统计弹窗，与右侧操作菜单中的入口相同。

实例右侧 **操作** 菜单提供启动、停止、重启、网络配置、实例详情和删除等入口。停止与重启会中断实例服务；删除实例不可恢复。批量操作通过列表复选框选择目标后执行。

资源列表采用两种同步方式：

- **日常同步：** 缓存有效期为 5 分钟。页面可见时按缓存到期时间更新，隐藏时暂停日常刷新，恢复可见后补齐已过期数据。缓存仍有效时，刷新网页或切换页面会复用数据。
- **操作状态跟踪：** 创建、启动、停止、重启、删除、IPv6、静态 IP 和端口变更后，只查询目标资源的操作进度及实际状态。首分钟约每 5 秒检查，之后约每 15 秒检查；并发受限，完成后停止。对应资源列表自动更新，其他账户、区域、套餐目录和流量缓存继续复用。
- **手动刷新：** 点击页面的 **刷新**，主动重新查询当前筛选范围，适用于需要立即核对 AWS 控制台外部变更的情况。

进度跟踪保存在服务器中，页面刷新或面板重启后继续。前端查询进度读取本地记录，不触发全区域扫描；超过 10 分钟仍未完成时停止该次跟踪并提示核对，手动刷新可重新核对状态并恢复跟踪。扫描发现处于过渡状态的实例时，也会加入目标状态跟踪。

### 创建实例

1. 点击 **创建实例** 或实例列表中的 **启动新实例**。
2. 选择目标 AWS 账户与区域；区域按列表第一项作为初始选择，创建页的选择不会修改顶部查询范围。
3. 在 **选择网络类型** 中选择 **双堆栈** 或 **仅限 IPv6**。双堆栈提供公网 IPv4 与 IPv6；仅 IPv6 不提供公网 IPv4，访问端需要支持 IPv6。
4. 选择系统镜像与通用型套餐。Debian 排在镜像列表前方；套餐展示内存、vCPU、SSD、每月流量与月价，以当前区域 AWS 目录为准。
5. 填写实例名称、数量及可用区。批量创建会在名称后追加 `-1`、`-2` 等后缀；可用区以 AWS 返回的有效列表为准。
6. 按需配置下文的防火墙与静态 IP。保持未勾选时使用 AWS 默认防火墙，且不自动分配静态 IP。
7. 使用默认 SSH 密钥。需要从外部 SSH 客户端连接时，可下载该账户、该区域的默认 `.pem` 私钥并妥善保管。
8. 检查启动脚本。默认脚本中的密码占位符必须替换；不需要启动脚本时，清空输入框。
9. 点击创建，在确认窗口核对账户、区域、镜像、套餐、数量及网络配置，再提交。

### 创建时配置防火墙与静态 IP

**防火墙：** 勾选 **创建后设置防火墙**，初始开放所有协议及端口，来源为所选网络类型支持的全部公网 IPv4 / IPv6。需要限制访问时，删除该规则，再添加指定协议、端口范围及 CIDR 来源。添加更宽的规则会移除被其完全覆盖的规则，已被覆盖的规则不会重复添加。提交时列出的规则会替换 AWS 默认公网规则。

**静态 IP：** 勾选 **自动分配并绑定静态 IPv4**，实例就绪后为每台实例分配并绑定一个同区域地址。仅 IPv6 实例禁用此选项。分配受 AWS 静态 IP 配额限制；地址自动命名，完成后可在静态 IP 页面查看。

AWS `CreateInstances` 本身没有这两个配置参数，面板在实例就绪后调用 `PutInstancePublicPorts`、`AllocateStaticIp` 和 `AttachStaticIp`。进度保存在服务器数据库中，刷新页面或重启面板后继续处理；前端每 5 秒读取本地进度，不会因此重新扫描全部区域。接口依据见 [权限文档](docs/PERMISSIONS.md)。

网络配置失败时，已创建的实例继续保留，列表提示具体失败项目。请更新权限或核对配额，然后在防火墙、静态 IP 页面完成配置，避免重新提交创建相同实例。处理超过 10 分钟会停止自动尝试并提示核对；无法确认绑定结果的静态 IP 会保留并标明名称。

### 静态 IP、防火墙与流量

- **静态 IP：** 列表支持全部账户、全部区域；分配时选择具体账户和区域。绑定目标须在相同账户与区域且具备 IPv4 网络。已绑定地址先解绑，再释放；释放后无法保证再次取得同一地址。
- **防火墙：** 选择实例，查看当前规则，再新增或关闭允许来源、协议和端口。这里管理 Lightsail 公网防火墙，实例操作系统内的防火墙须在服务器中另外配置。
- **流量统计：** 选择实例和时间范围，查看入站、出站、合计与每日汇总。今日从浏览器本地零点开始；近 7 天和近 30 天按包含今日的自然日计算，各范围使用同一日期边界。
- **操作日志：** 查看创建、启停、网络配置等操作的时间、目标和执行结果，用于定位权限或 API 错误。

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

容器内部固定使用 `HOST=0.0.0.0`、`PORT=4180`、`DATA_DIR=/app/data`。宿主机端口仍通过 `PANEL_PORT` 自定义。

运行标识统一如下：

| 项目 | 名称或命令 |
| --- | --- |
| Compose 项目、服务、Docker 容器与容器 hostname | `lightsail-panel` |
| npm 包与容器内启动命令 | `lightsail-panel` |
| Docker 默认启动命令（CMD） | `["lightsail-panel"]` |
| 容器内健康检查 | `lightsail-panel --healthcheck` |
| Linux 主进程与线程名称 | `lightsail-panel` |
| 持久化数据卷（兼容旧部署） | `lightsail-panel_panel-data` |

实际数据卷名继续使用 `lightsail-panel_panel-data`，确保旧部署的数据库与加密密钥保持可用。容器内启动命令直接运行 Node.js 服务，服务作为 PID 1 接收停止信号。Linux 使用 `ps`、`top` 或 `htop` 查看时显示 `lightsail-panel`；运行期间新增的线程名称在 30 秒内同步，此过程仅访问本地 `/proc`，不调用 AWS API。

可在宿主机验证名称和启动命令：

```bash
docker inspect --format '{{.Name}} {{json .Config.Cmd}}' lightsail-panel
docker top lightsail-panel -eo pid,comm,args
docker exec lightsail-panel sh -c 'cat /proc/1/comm; cat /proc/1/task/*/comm'
```

## 数据备份与恢复

数据卷包含 SQLite 数据库、管理员配置、AWS 账户加密凭证、操作日志和 `encryption.key`。恢复时必须保留数据库及其对应的加密密钥；若通过环境变量提供密钥，还需单独保存该变量。

以下命令适用于 Linux 宿主机。备份前停止服务，以保持数据库一致性：

```bash
mkdir -p backups
docker compose stop lightsail-panel
docker run --rm \
  -v lightsail-panel_panel-data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine:3.22 tar -czf /backup/panel-data.tar.gz -C /data .
docker compose start lightsail-panel
```

恢复到空的数据卷：

```bash
docker compose stop lightsail-panel
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

旧配置中的服务名为 `panel`，容器名由 Compose 自动生成。首次升级到统一名称时，在原部署目录完成备份后执行以下命令。停止旧容器后再更新配置，可以避免两个容器争用宿主机端口；现有 `.env` 与数据卷继续保留：

```bash
docker compose down --remove-orphans
curl -fsSLo compose.yaml https://raw.githubusercontent.com/haoch1/lightsail-panel/main/compose.yaml
docker compose pull
docker compose up -d
docker compose ps
```

从此前的源码构建部署迁移时，在原项目目录执行以下命令；保留现有 `.env` 和数据卷：

```bash
docker compose down --remove-orphans
git pull --ff-only
docker compose pull
docker compose up -d
```

常用维护命令：

```bash
docker compose logs -f --tail=100 lightsail-panel
docker compose restart lightsail-panel
docker compose stop lightsail-panel
docker compose down
```

## 常见问题

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
| Secret Access Key 遗失      | AWS 不再展示已创建的 Secret Access Key；创建新密钥并添加到面板，验证后停用旧密钥。               |
| 身份验证成功但没有实例      | 核对该凭证所属账户、查询范围及 Lightsail 查询权限；确认资源为 Lightsail 实例。                   |
| 创建后防火墙设置失败        | 更新统一策略，确认包含 `lightsail:PutInstancePublicPorts`，再在防火墙页面设置规则。              |
| 静态 IP 分配或绑定失败      | 检查目标区域配额、IPv4 支持及 IAM 权限；根据网络配置提示核对已保留的地址。                       |
| 创建后仍显示配置中          | AWS 操作异步完成；等待进度更新。重启后会继续处理，超过 10 分钟按提示核对资源。                   |
| 自动更新后数据仍有延迟      | AWS 流量指标截至最近完成的整点，AWS 状态和指标返回本身可能存在延迟。                             |

排查部署问题时，依次检查容器状态、健康接口和近期日志：

```bash
docker compose ps
curl -fsS http://127.0.0.1:8090/api/health
docker compose logs --tail=100 lightsail-panel
```

端口改为其他值时同步修改健康检查地址。提交问题反馈时，提供镜像标签、服务器架构、操作步骤和去除敏感信息的错误文本。

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

GitHub Actions 在 amd64 与 arm64 原生 runner 上分别构建并验证 Docker 镜像，全部通过后发布多架构镜像至 GHCR；Pull Request 仅执行构建与测试，不发布镜像。验证内容包括健康检查、HTTP 响应、非 root 运行、实际启动命令、PID 1 及线程名称、停止信号处理。发布后还会通过 Compose 拉取镜像，检查容器名称与现有数据卷复用。代码结构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 许可证

[MIT License](LICENSE)
