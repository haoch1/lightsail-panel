# Lightsail Panel

[![Docker CI](https://github.com/haoch1/lightsail-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/haoch1/lightsail-panel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Lightsail Panel 是 Amazon Lightsail 的自托管中文管理面板，支持多账户与跨区域资源管理、网页 SSH、流量统计、阈值自动关机和登录有效期设置。

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
- [开发与验证](#开发与验证)

## 功能

| 模块     | 功能                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 实例管理 | 跨账户、跨区域查询；名称与 IP 搜索；状态筛选；批量启动与停止；重启、删除、IPv6 切换和公网 IP 更换                                           |
| 网页 SSH | 从实例操作菜单打开终端；临时证书认证、主机身份校验；终端输入、复制粘贴、尺寸同步、全屏切换、断开与重连                                      |
| 实例信息 | 系统、规格、套餐价格、公网与私网地址；本月流量进度、套餐额度、使用比例及上行与下行明细                                                      |
| 实例创建 | Debian、Ubuntu、CentOS 系统镜像；通用型套餐；双栈与仅 IPv6 网络；可用区选择；默认 SSH 密钥与启动脚本；可选防火墙规则及自动分配、绑定静态 IP |
| 静态 IP  | 按账户与区域分配地址；绑定、解绑和释放；禁止直接释放已绑定地址                                                                              |
| 防火墙   | TCP、UDP、ICMP 与所有协议规则；单端口和端口范围；IPv4、IPv6 与 CIDR 来源限制                                                                |
| 流量统计 | 本月、今日、近 7 天、近 30 天；入站、出站与合计流量；按日汇总                                                                               |
| 自动关机 | 每台实例独立设置 0.1–100% 的套餐流量阈值；按本月入站＋出站合计判断；每 5 分钟后台检查并停止达到阈值的实例                                   |
| 登录管理 | 12 小时、1 天、7 天、30 天、90 天有效期；默认 30 天；当前浏览器会话续期与退出                                                               |
| 账户管理 | Access Key ID 与 Secret Access Key 身份验证、加密保存、重新验证和移除                                                                       |
| 操作日志 | 记录资源操作、执行结果与错误信息                                                                                                            |

## Docker 部署

预构建镜像：[`ghcr.io/haoch1/lightsail-panel:latest`](https://github.com/haoch1/lightsail-panel/pkgs/container/lightsail-panel)，支持 `linux/amd64` 和 `linux/arm64`，由 Docker 自动选择目标架构。

### 1. 准备环境

依赖：[Docker Engine](https://docs.docker.com/engine/install/)、Docker Compose v2 和 curl。服务器须能访问 GitHub、GHCR 和 AWS API；Docker 命令须具有执行权限，必要时使用 `sudo`。公开镜像支持匿名拉取。

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

编辑 `.env`。默认监听地址为 `127.0.0.1:8090`，宿主机端口由 `PANEL_PORT` 指定。AWS Access Key 通过面板管理。

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
{ "ok": true, "version": "1.7.3", "service": "lightsail" }
```

远程连接可使用 SSH 端口转发：

```bash
ssh -N -L 8090:127.0.0.1:8090 user@server
```

浏览器访问 `http://127.0.0.1:8090`。域名访问配置见 [HTTPS 反向代理](#https-反向代理)。

直接通过服务器 IP 访问时，将 `PANEL_BIND` 改为 `0.0.0.0`，执行 `docker compose up -d`，并在防火墙中允许指定来源访问宿主机端口。公网访问应使用 HTTPS。

### 4. 初始化管理员

首次访问时设置至少 12 个字符的管理员密码，并选择登录有效期，默认 30 天。完成初始化后添加 AWS 账户。

## 获取 Access Key 与配置 IAM

面板使用 **Access Key ID** 与 **Secret Access Key** 调用 AWS API。推荐创建专用 IAM 用户，附加本项目的统一权限策略。

### 方式一：专用 IAM 用户（推荐）

#### 1. 创建 IAM 用户

1. 使用具有 IAM 管理权限的身份登录 [AWS IAM 控制台](https://console.aws.amazon.com/iam/)。
2. 打开 **Users（用户）→ Create user（创建用户）**。
3. 填写用户名，例如 `lightsail-panel`。该用户仅供面板调用 API，无需开启 AWS Management Console 登录权限。
4. 完成创建并打开用户详情页。

#### 2. 创建并附加统一权限策略

1. 打开 **Policies（策略）→ Create policy（创建策略）**。
2. 在 **Policy editor（策略编辑器）** 中选择 **JSON**。
3. 将 [docs/iam-policy.json](docs/iam-policy.json) 的完整内容粘贴至编辑器。
4. 检查策略内容并点击 **Next（下一步）**，填写策略名称，例如 `LightsailPanelPolicy`，然后创建策略。
5. 返回 **Users → lightsail-panel → Permissions（权限）**。
6. 选择 **Add permissions（添加权限）→ Attach policies directly（直接附加策略）**，搜索并勾选 `LightsailPanelPolicy`，完成添加。

此策略覆盖面板全部功能，不授予账单、快照和备份管理权限，详见 [权限文档](docs/PERMISSIONS.md)。

#### 3. 创建 Access Key

1. 在该 IAM 用户详情页选择 **Security credentials（安全凭证）**。
2. 找到 **Access keys（访问密钥）**，点击 **Create access key（创建访问密钥）**。
3. 在用途页面选择 **Other（其他）**，继续下一步。可填写用途描述 `Lightsail Panel`。
4. 创建后保存 **Access Key ID** 与 **Secret Access Key**，或下载 CSV。
5. Secret Access Key 仅在创建时显示，遗失后须重新创建密钥。

每个 IAM 用户最多拥有两对 Access Key，管理方法见 [AWS 文档](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-key-self-managed.html)。

### 方式二：Root user 的 Access Key（补充说明）

[图文教程](https://www.hidandelion.com.cn/how-to-get-aws-access-key-for-slauncher-pro/) 使用此方式，无需附加 IAM 用户策略。Root user 密钥具备账户级权限，[AWS 建议避免创建](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user_manage_add-key.html)。

1. 在 AWS 登录页面选择 **Root user**，使用 AWS 账户邮箱和密码登录，按提示完成 MFA。
2. 点击控制台右上角账户名称或账户编号，选择 **Security credentials（安全凭证）**。
3. 在 **Access keys** 区域点击 **Create access key**。
4. 阅读 **Alternatives to root user access keys** 页面中的说明；决定继续时，勾选确认项并创建。
5. 在 **Retrieve access key** 页面保存 Access Key ID 与 Secret Access Key，或下载 CSV。

### 将凭证添加到面板

1. 登录 Lightsail Panel，点击右上角 **AWS 账户管理**。
2. 选择 **添加 AWS 账户**，填写以下三项：

   | 字段              | 内容                                    |
   | ----------------- | --------------------------------------- |
   | 账户名称          | 面板中的显示名称，例如 `生产环境`       |
   | Access Key ID     | 与 Secret Access Key 配对的访问密钥标识 |
   | Secret Access Key | 创建访问密钥时保存的密钥内容            |

3. 点击 **验证并保存**。应用通过 `STS GetCallerIdentity` 验证身份，成功后加密保存凭证。

账户验证仅确认凭证身份。资源操作受 IAM 权限、区域状态和配额限制，目标区域在资源页面选择。

密钥和 CSV 不应提交至 Git 仓库。移除面板账户不会停用 AWS Access Key 或删除云资源；撤销访问需在 AWS **Security credentials → Access keys** 中停用或删除密钥。

## 面板使用流程

### 查询与管理实例

顶部 **区域范围** 和 **账户** 默认为 **全部区域** 与 **全部账户**。实例列表支持名称、IP 和状态筛选；**操作** 菜单提供单实例管理，列表复选框支持批量操作。

价格按 AWS 套餐月价展示，停止后仍计费。停止与重启会中断服务，删除不可恢复。

**本月流量** 展示已用量、套餐月额度和使用比例。悬停显示入站与出站明细，点击打开流量统计；缺失额度或指标时显示未知。

刷新方式：

- **自动同步：** 每小时 00、05、10、15 分等 5 分钟时间点更新，页面隐藏时暂停；页面刷新与切换复用有效缓存。
- **操作跟踪：** 资源变更后仅查询目标状态，首分钟约每 5 秒、之后约每 15 秒检查，完成后更新列表并停止跟踪。
- **手动刷新：** 立即重新查询当前筛选范围。

查询期间保留资源快照，响应返回后局部更新。连接异常提示支持关闭，恢复后自动清除。

操作进度持久化保存，页面刷新或服务重启后恢复跟踪。超过 10 分钟仍未完成时提示核对资源，手动刷新可重新检查。

### SSH 终端

在运行中的实例选择 **操作 → SSH 终端**。登录用户由 AWS 返回，Debian 通常为 `admin`；具备 sudo 权限时可通过 `sudo -i` 切换至 root。终端支持复制粘贴、尺寸同步、全屏切换和重连；全屏切换保持连接，关闭窗口断开连接。

终端聚焦时，`Ctrl+Shift+C` 复制选中文本，`Ctrl+C` 中断远程命令。无选区时复制操作保留剪贴板内容；复制粘贴须授予浏览器剪贴板权限。

连接要求：授予 `lightsail:GetInstanceAccessDetails` 权限，面板服务器可访问实例 TCP 22 端口，实例保留 Lightsail 临时证书认证配置。仅 IPv6 实例要求服务器具备 IPv6 连通性。支持范围为交互式终端，不提供自定义端口或文件传输。

临时凭证仅在服务端使用，保存在受限临时目录，连接结束后删除；主机密钥依据 AWS 记录严格校验。退出登录、会话到期、移除账户或停止服务均会断开连接，SSH 会话不持久化。

Docker 镜像内置 OpenSSH 客户端，源码部署须安装该客户端。反向代理须支持 WebSocket 转发。操作日志仅记录连接目标与结果，终端输入输出不写入日志。

### 登录有效期

有效期支持 12 小时、1 天、7 天、30 天和 90 天，默认 30 天，在初始化或登录时选择。登录后通过顶部 **登录有效期** 按钮查看或修改期限，保存时从当前时间重新计算，仅作用于当前浏览器会话。

普通请求不延长有效期，到期后须重新登录；**退出登录** 立即注销当前会话。

### 自动关机

1. 选择 **操作 → 自动关机**，查看本月流量进度、套餐额度和使用比例。
2. 勾选 **启用自动关机**，设置 **套餐流量阈值（%）**，范围为 0.1–100%，初始值为 90%。
3. **保存** 后立即检查。规则按实例独立配置，默认关闭；取消勾选并保存后停用。

使用比例为 `本月（NetworkIn + NetworkOut）÷ 套餐月流量额度 × 100%`。3 TiB 套餐设置 90% 阈值时，合计达到 2.7 TiB 后提交停止请求。额度取自目标区域的 AWS 套餐目录，月份按规则保存时的本地时区计算。

- **调度：** 每小时 00、05、10 分等时间点检查；资源操作完成后立即检查目标实例。执行独立于浏览器会话。
- **异常：** 实例身份变化或权限失败时暂停规则；查询失败或指标不完整时跳过关机。停止结果不确定时暂停重试，须核对实例后重新保存规则。结果写入 **操作日志**。
- **限制：** AWS 指标延迟可能造成阈值超出，统计值不等同于计费流量。停止后套餐仍计费，下月不自动启动；手动启动或重启后规则继续生效。

规则与检查进度持久化至 SQLite，服务启动后恢复执行，容器须持续运行。授权要求见 [权限文档](docs/PERMISSIONS.md)。

### 创建实例

1. 点击 **创建实例** 或实例列表中的 **启动新实例**。
2. 选择目标 AWS 账户与区域，区域初始选择为列表第一项。
3. 在 **选择网络类型** 中选择 **双堆栈** 或 **仅限 IPv6**。双堆栈提供公网 IPv4 与 IPv6；仅 IPv6 不提供公网 IPv4，访问端需要支持 IPv6。
4. 选择系统镜像与通用型套餐，参数以目标区域的 AWS 目录为准。
5. 填写实例名称、数量及可用区。批量创建会在名称后追加 `-1`、`-2` 等后缀；可用区以 AWS 返回的有效列表为准。
6. 按需启用防火墙与静态 IP 配置。默认使用 AWS 防火墙规则，不分配静态 IP。
7. 默认 SSH 密钥按账户与区域管理，可下载 `.pem` 私钥供外部客户端使用。
8. 配置启动脚本并替换密码占位符；无需脚本时清空该字段。
9. 点击创建，核对确认窗口中的配置并提交。

### 创建时配置防火墙与静态 IP

**防火墙：** 勾选 **创建后设置防火墙**，初始开放所有协议、端口及公网来源。需要限制访问时，删除初始规则，再添加协议、端口和 CIDR。较宽规则会移除被其完全覆盖的规则；提交后替换 AWS 默认公网规则。

**静态 IP：** 勾选 **自动分配并绑定静态 IPv4**，实例就绪后为每台实例绑定一个同区域地址。仅 IPv6 实例禁用此选项；分配受区域配额限制。

网络配置失败时保留实例并显示失败项，修正权限或配额后可在对应页面完成配置。绑定结果不确定的静态 IP 保留并标明名称。

### 静态 IP、防火墙与流量

- **静态 IP：** 分配时选择具体账户和区域，绑定目标须在同一账户、区域且支持 IPv4。已绑定地址先解绑再释放；未绑定地址可能产生费用，释放后不保证再次取得同一地址。
- **防火墙：** 管理实例公网规则的协议、端口与允许来源。操作系统防火墙须在实例内部单独配置。
- **流量统计：** 支持本月、今日、近 7 天和近 30 天，均从浏览器本地日期零点起算，包含今日。数据查询截至最近完成的 5 分钟；历史按小时汇总，首尾不足一小时的部分使用 5 分钟指标，不重叠计算。指标涵盖全部网卡，缺失数据保持未知。
- **操作日志：** 查看创建、启停、网络配置等操作的时间、目标和执行结果，用于定位权限或 API 错误。

## HTTPS 反向代理

以下配置适用于 Nginx 与面板部署在同一服务器。配置域名解析和 TLS 证书后，设置 `.env`：

```dotenv
PUBLIC_ORIGIN=https://panel.example.com
```

重新创建容器以应用配置：

```bash
docker compose up -d
```

Nginx 配置示例，按实际部署替换域名与证书路径：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

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
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
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
| `PANEL_IMAGE`    | `ghcr.io/haoch1/lightsail-panel:latest` | 镜像引用，支持版本标签、提交标签或 `@sha256:...` 摘要                   |
| `PANEL_BIND`     | `127.0.0.1`                             | Compose 在宿主机绑定的地址                                              |
| `PANEL_PORT`     | `8090`                                  | Compose 在宿主机发布的端口                                              |
| `PUBLIC_ORIGIN`  | 空                                      | 浏览器访问来源；HTTPS 反向代理时设置                                    |
| `ENCRYPTION_KEY` | 自动生成                                | 可选的 32 字节 Base64 加密密钥；未配置时写入数据卷中的 `encryption.key` |

容器内部固定使用 `HOST=0.0.0.0`、`PORT=8090`、`DATA_DIR=/app/data`。宿主机端口通过 `PANEL_PORT` 自定义，例如 `PANEL_PORT=9000` 对应 `9000:8090`。

Compose 项目、服务、容器、启动命令和 Linux 进程、线程名称统一为 `lightsail-panel`；数据卷为 `lightsail-panel-data`。实现说明见 [架构文档](docs/ARCHITECTURE.md)。

## 数据备份与恢复

数据卷包含 SQLite 数据库、管理员配置、AWS 账户加密凭证、登录会话、自动关机规则、资源操作进度、操作日志和 `encryption.key`。恢复时必须保留数据库及其对应的加密密钥；若通过环境变量提供密钥，还需单独保存该变量。

以下命令适用于 Linux 宿主机。备份前停止服务，以保持数据库一致性：

```bash
mkdir -p backups
docker compose stop lightsail-panel
docker run --rm \
  -v lightsail-panel-data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine:3.22 tar -czf /backup/lightsail-panel-data.tar.gz -C /data .
docker compose start lightsail-panel
```

恢复到空的数据卷：

```bash
docker compose stop lightsail-panel
docker volume create lightsail-panel-data
docker run --rm \
  -v lightsail-panel-data:/data \
  -v "$PWD/backups:/backup:ro" \
  alpine:3.22 sh -c 'tar -xzf /backup/lightsail-panel-data.tar.gz -C /data && chown -R 1000:1000 /data'
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

`latest` 在 `main` 分支构建与测试通过后更新；固定镜像时，在 `PANEL_IMAGE` 中指定 [标签或摘要](https://github.com/haoch1/lightsail-panel/pkgs/container/lightsail-panel)。

常用维护命令：

```bash
docker compose logs -f --tail=100 lightsail-panel
docker compose restart lightsail-panel
docker compose stop lightsail-panel
docker compose down
```

## 常见问题

| 问题                           | 处理方法                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| 浏览器无法访问                 | 确认容器正常运行、宿主机端口未被占用，以及端口转发或反向代理配置正确。默认端口仅监听服务器本机。 |
| 无法拉取镜像                   | 确认服务器能够连接 `ghcr.io`，并核对 `PANEL_IMAGE` 中的仓库地址和标签。默认公开镜像不需要登录。  |
| 请求来源不被允许               | 检查 `PUBLIC_ORIGIN` 是否与浏览器访问来源完全一致，修改后执行 `docker compose up -d`。           |
| AWS 身份验证失败               | 检查两项密钥是否来自同一 IAM 用户、访问密钥是否启用，以及服务器是否能够访问 AWS STS。            |
| 查询或操作提示 AccessDenied    | 将当前 [IAM 策略](docs/iam-policy.json) 附加至对应用户，并核对组织策略、权限边界和显式拒绝规则。 |
| 创建区域不可用                 | 在 AWS 中确认目标区域已启用、Lightsail 可用且配额充足。                                          |
| 保存凭证无法解密               | 恢复与数据库匹配的 `encryption.key` 或 `ENCRYPTION_KEY`。                                        |
| 页面资源加载失败               | 刷新页面以加载最新构建资源，并确认反向代理未长期缓存 HTML。                                      |
| 无法连接面板服务               | 检查容器状态、网络连接与反向代理配置，恢复后执行手动刷新。                                       |
| Another request is in progress | AWS 正在处理该资源的其他请求。等待现有操作结束，刷新确认资源状态后再重试。                       |
| 身份验证成功但没有实例         | 核对该凭证所属账户、查询范围及 Lightsail 查询权限；确认资源为 Lightsail 实例。                   |
| 创建后防火墙设置失败           | 更新统一策略，确认包含 `lightsail:PutInstancePublicPorts`，再在防火墙页面设置规则。              |
| 静态 IP 分配或绑定失败         | 检查目标区域配额、IPv4 支持及 IAM 权限；根据网络配置提示核对已保留的地址。                       |
| 创建后仍显示配置中             | AWS 操作异步完成；等待进度更新。重启后会继续处理，超过 10 分钟按提示核对资源。                   |
| 自动更新后数据仍有延迟         | 每 5 分钟重新查询，历史按小时汇总且包含当前小时已完成的 5 分钟区间；AWS 指标可能尚未报告。       |
| 会话到期后的自动关机           | 规则由服务端独立执行，不依赖浏览器会话；容器须保持运行。                                         |
| 自动关机规则暂停或未执行       | 在实例的自动关机窗口查看原因，核对 IAM 权限、套餐额度、指标及实例身份；解决后重新启用并保存。    |
| 流量进度显示未知               | 当前套餐未返回有效额度或流量查询尚未完成、失败；不会将未知数据作为 0% 或触发关机。               |
| SSH 终端无法连接               | 检查实例运行状态、`GetInstanceAccessDetails` 权限、TCP 22 连通性及 WebSocket 转发配置。          |

排查部署问题时，依次检查容器状态、健康接口和近期日志：

```bash
docker compose ps
curl -fsS http://127.0.0.1:8090/api/health
docker compose logs --tail=100 lightsail-panel
```

自定义端口须同步修改健康检查地址。问题报告应包含镜像标签、服务器架构、复现步骤和脱敏错误信息。

## 开发与验证

开发环境需要 Node.js 24、pnpm 11.25.0 和 OpenSSH 客户端。Linux 安装依赖时还需 Python 3、make 与 C++ 编译器，用于构建终端模块：

```bash
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

开发界面为 `http://127.0.0.1:4173`，API 为 `http://127.0.0.1:8090`。

```bash
pnpm check
pnpm test
pnpm build
```

从源码构建镜像：

```bash
docker build -t lightsail-panel:local .
PANEL_IMAGE=lightsail-panel:local docker compose up -d --pull never
```

GitHub Actions 在 amd64 和 arm64 原生 runner 上完成构建、测试、容器启动及 Compose 部署验证后发布镜像；Pull Request 仅验证。容器以非 root 用户运行，启用 `no-new-privileges` 并移除 Linux capabilities。

演示入口：`/lightsail?demo=1`。数据与操作在浏览器内模拟，包括流量进度、自动关机设置和 SSH 终端，不调用 AWS API。

## 许可证

[MIT License](LICENSE)
