<div align="center">

# LightSail Panel

**Amazon Lightsail 自托管中文管理面板**

多账户跨区域管理 · 网页 SSH 终端 · 按日流量图表 · 阈值自动关机 · Telegram 通知 · 桌面与移动端适配

[![Docker CI](https://github.com/haoch1/lightsail-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/haoch1/lightsail-panel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-18181b.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-18181b.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/GHCR-linux%2Famd64-18181b.svg)](https://github.com/haoch1/lightsail-panel/pkgs/container/lightsail-panel)

</div>

---

## 简介

**LightSail Panel** 是面向 Amazon Lightsail 的轻量级自托管管理面板，采用 **React 19 + TypeScript + Node.js 24 + SQLite** 构建，单容器即可运行，无需外部数据库或消息队列。

- **极简黑白界面**：统一黑白灰设计体系，支持浅色 / 自动 / 深色一键切换，深度适配桌面与手机端操作。
- **开箱即用安全**：管理员密码使用 `scrypt` 哈希，AWS Access Key 与 Telegram Token 采用 `AES-256-GCM` 加密落盘，全接口启用会话、CSRF 与同源校验。
- **内置演示模式**：访问 `/?demo=1` 即可在浏览器本地体验完整交互，无需配置真实 AWS 凭证。

## 核心功能

| 模块 | 能力说明 |
| :--- | :--- |
| **实例管理** | 跨账户、跨区域汇总展示；名称 / IP 搜索与状态筛选；单台及批量启动、停止、重启、删除、IPv6 切换与公网 IP 更换 |
| **创建实例** | 支持 Debian / Ubuntu / CentOS 镜像、通用型套餐、双栈与仅 IPv6 网络、可用区选择、启动脚本、预设防火墙及自动绑定静态 IP |
| **网页 SSH** | 基于 Lightsail 临时证书认证与主机密钥校验；支持复制粘贴、窗口自适应、全屏及移动端快捷按键栏（`Esc`/`Tab`/`Ctrl+C`/方向键） |
| **静态 IP** | 按账户与区域分配、绑定、解绑及释放静态 IPv4，自动拦截已绑定地址的误释放 |
| **防火墙** | 管理 TCP / UDP / ICMP / 全部协议规则，支持单端口、端口段以及 IPv4 / IPv6 / CIDR 来源限制 |
| **流量统计** | 本月、近 7 天、近 30 天入站 / 出站 / 合计统计，支持交互式每日柱状图与可折叠明细 |
| **阈值自动关机** | 每台实例独立设置 `0.1%–100%` 月度流量阈值，后台每 5 分钟巡检并在触达阈值时自动停机 |
| **后台同步与日志** | SQLite 资源快照 + 后台定时采集 + SSE 实时推送；操作进度持久化追踪，单条操作日志实时更新结果 |
| **Telegram 通知** | 支持按事件类型订阅、每日定时汇总、消息预览、测试发送与持久化失败重试，详见 [Telegram 文档](docs/TELEGRAM.md) |

## 快速部署（Docker Compose）

预构建镜像：`ghcr.io/haoch1/lightsail-panel:latest`（`linux/amd64`）。

```bash
mkdir -p lightsail-panel && cd lightsail-panel
curl -fsSLo compose.yaml https://raw.githubusercontent.com/haoch1/lightsail-panel/main/compose.yaml
curl -fsSLo .env.example https://raw.githubusercontent.com/haoch1/lightsail-panel/main/.env.example
cp .env.example .env
```

按需编辑 `.env`（默认仅监听 `127.0.0.1:8090`）：

```dotenv
PANEL_IMAGE=ghcr.io/haoch1/lightsail-panel:latest
PANEL_BIND=127.0.0.1
PANEL_PORT=8090
# 配置 HTTPS 反向代理时填写外部访问来源（不含路径与末尾斜杠）
# PUBLIC_ORIGIN=https://lightsail.example.com
```

拉取镜像并启动：

```bash
docker compose pull
docker compose up -d
curl -fsS http://127.0.0.1:8090/api/health
```

远程服务器可通过 SSH 隧道访问：

```bash
ssh -N -L 8090:127.0.0.1:8090 user@server
```

随后在浏览器打开 `http://127.0.0.1:8090`，首次访问设置至少 12 位管理员密码，进入 **系统设置 → AWS 账户** 添加凭证即可。

> 若通过域名公网访问，请在 Nginx / Caddy 等反向代理层启用 HTTPS，并开启 **WebSocket**（用于网页 SSH）及关闭 **SSE 缓冲**（`proxy_buffering off`）。

## AWS IAM 权限配置

推荐为面板创建专用 IAM 用户，并将仓库内的最小权限策略 [docs/iam-policy.json](docs/iam-policy.json) 附加给该用户：

1. 登录 [AWS IAM 控制台](https://console.aws.amazon.com/iam/)，创建仅供 API 调用的 IAM 用户（无需控制台登录权限）。
2. 新建自定义策略，粘贴 [docs/iam-policy.json](docs/iam-policy.json) 并绑定到该用户（详细说明见 [docs/PERMISSIONS.md](docs/PERMISSIONS.md)）。
3. 在 **Security credentials → Access keys** 中创建 Access Key，填入面板 **系统设置 → AWS 账户**，点击 **验证并保存**。

## 数据备份与更新

- **持久化数据**：Docker 命名卷 `lightsail-panel-data`（容器内 `/app/data`）保存 `panel.sqlite` 与 `encryption.key`，**备份时须同时保存二者**。
- **版本更新**：
  ```bash
  docker compose pull && docker compose up -d
  ```

## 本地开发

环境要求：`Node.js >= 24.0.0`、`pnpm 11.25.0`（开发网页 SSH 需本机已安装 OpenSSH 客户端）。

```bash
git clone https://github.com/haoch1/lightsail-panel.git
cd lightsail-panel
pnpm install --frozen-lockfile
pnpm dev        # 启动前后端开发服务（支持 /?demo=1 演示模式）
pnpm check      # TypeScript 类型检查
pnpm test       # 运行自动化测试套件
pnpm build      # 构建生产前端资源
```

## 相关文档

- [系统架构](docs/ARCHITECTURE.md)
- [IAM 权限说明](docs/PERMISSIONS.md)
- [Telegram 通知配置](docs/TELEGRAM.md)
- [界面与交互说明](docs/UI.md)

## 姊妹项目

- [aliyun-panel](https://github.com/haoch1/aliyun-panel) — 同款设计体系的阿里云 ECS 自托管管理面板（实例保活、流量保护、定时开关机、账单余额与 Telegram 通知）。

## License

[MIT](LICENSE)
