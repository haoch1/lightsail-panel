# 架构说明

Lightsail Panel 采用浏览器前端与同源 HTTP API。React 负责资源展示和交互，Node.js 24 负责认证、输入校验、AWS 请求、凭证加密与数据持久化。

## 目录结构

| 目录                | 职责                                               |
| ------------------- | -------------------------------------------------- |
| `src/app`           | 路由、导航、主题、账户与区域上下文                 |
| `src/features`      | 账户、实例、创建、静态 IP、防火墙、流量与操作日志  |
| `src/components/ui` | 表单、下拉选择、弹窗、按钮和状态反馈               |
| `src/hooks`         | 资源读取、实例扫描、流量查询与自动更新             |
| `src/lib`           | API 请求、缓存、资源目标、菜单定位和数值格式       |
| `src/styles`        | 主题、布局、控件、业务样式与响应式规则             |
| `src/demo`          | 在浏览器内运行的示例数据和操作                     |
| `shared`            | 类型、区域标签、镜像排序、刷新策略和流量计算       |
| `server/http`       | HTTP 路由、参数校验与操作审计                      |
| `server/aws`        | SDK 客户端、传输、目录、实例、网络、默认密钥与指标 |
| `server/store.mjs`  | SQLite、账户凭证加密、会话与日志持久化             |
| `bin/lightsail-panel.mjs` | 统一启动入口与容器健康检查 |
| `server/runtime-identity.mjs` | 进程标题与 Linux 线程名称同步 |
| `tests`             | 请求安全、SDK 输入、资源处理、数据计算与缓存验证   |
| `.github/workflows` | Docker 构建与容器运行检查                          |

## 请求路径

`server/app.mjs` 在业务路由前执行来源校验、会话认证和 CSRF 校验。读取与修改资源的参数通过 Zod 校验后交给 `AwsGateway`。资源操作调用官方 Lightsail API，账户添加使用 STS 查询身份。

账户凭证仅在服务器侧解密。公开的账户列表返回元数据与密钥尾号，不返回 Secret Access Key。默认 SSH 私钥下载受登录、来源和 CSRF 校验保护，响应禁止缓存。

账户内部保留 SDK 请求所需的验证端点区域；该值不作为资源筛选条件，也不暴露为添加账户表单字段。账户和资源区域由前端分别选择。

## 缓存与并发

`shared/refresh-policy.ts` 定义 5 分钟更新周期。服务器 `ReadCache` 按规范化查询路径缓存响应，合并并发请求，并缓存短期失败结果以避免重复访问。手动刷新绕过已完成的缓存；成功写操作使读取缓存失效。

前端跨页面共享资源缓存，复用有效数据和正在执行的请求。账户与区域扫描最多采用 4 路并发，按返回顺序更新结果。扫描期间保留已有资源，避免慢区域阻塞全部内容。

日常自动更新由当前可见页面的定时器驱动；页面隐藏或关闭后不执行定时扫描。服务器重启会清除内存查询缓存。

资源写操作仅使对应账户、区域和资源类别的前后端缓存失效，其他区域与价格、流量缓存继续复用。共享规则定义在 `shared/resource-update.ts`。写操作完成与异步状态变化通过应用级同步通知更新当前视图，避免操作后强制全区域扫描。

`server/launch-network.mjs` 将创建后的网络配置及资源操作跟踪持久化到 SQLite。工作队列只检查待完成操作，采用 5 秒至 15 秒间隔和受限并发，确认 AWS 操作完成及目标状态后停止，最长处理 10 分钟。创建实例即使没有可选网络配置，也跟踪至运行状态。前端读取本地进度，页面刷新、切换和服务重启不会重复执行创建或启停。

## 流量计算

流量使用 `GetInstanceMetricData`，指标为 `NetworkIn` 和 `NetworkOut`，统计方式为 `Sum`，单位为 `Bytes`。查询范围从浏览器时区的日期零点开始，到最近完成的 UTC 整点结束。

`shared/traffic.mjs` 负责时间窗口、重复点去除与按日汇总。本月、今日、近 7 天和近 30 天采用相同日期边界；缺失点和查询失败保持未知。数值仅在展示时格式化，流量保留两位小数。

## 持久化

数据目录包含 `panel.sqlite` 与 `encryption.key`。SQLite 采用 WAL 模式；管理员密码经过 scrypt 处理；账户凭证使用独立随机 IV 的 AES-256-GCM 加密；会话令牌以哈希保存。

Docker 通过命名卷持久化 `/app/data`。数据库与加密密钥必须共同备份和恢复。

## 运行标识

npm 包名、Compose 项目及服务、Docker 容器、容器 hostname 和启动命令统一为 `lightsail-panel`。Dockerfile 清除基础镜像继承的 entrypoint，实际容器启动命令为 `lightsail-panel`。`bin/lightsail-panel.mjs` 通过 shebang 直接运行 Node.js，容器启动后应用为 PID 1；`--healthcheck` 模式只检查本地健康端点，不加载数据库或 AWS 客户端。

`server/runtime-identity.mjs` 设置 `process.title`，并在 Linux 上将同一进程各线程的 `/proc/self/task/<tid>/comm` 统一为 `lightsail-panel`。启动时立即处理已有线程，1 秒后补齐启动期间创建的线程，此后每 30 秒仅修改新增或名称不同的线程。定时器使用 `unref`，停止服务时清理；不依赖 root 或额外 capabilities，不涉及网络请求。受限环境中无法访问 `/proc` 时仅记录一次警告，业务服务继续运行。

Compose 中的数据卷标识保留 `panel-data`，物理卷名显式固定为旧版 `lightsail-panel_panel-data`。卷标签与实际卷名均兼容旧部署，使服务与容器更名后仍挂载同一份账户数据与密钥。

## 扩展与验证

新增功能应依次定义共享类型、请求校验、AWS 方法、HTTP 路由和前端模块。新的 AWS 命令需要同步更新 IAM 策略与具有业务意义的模拟测试。

验证命令为 `pnpm check`、`pnpm test` 与 `pnpm build`。运行标识测试通过独立子进程验证标题、已有与后续创建的线程及健康检查退出码，避免改名测试执行器。Docker CI 在两种架构上额外验证实际启动命令、PID 1 与线程名称、健康检查、首次初始化状态、前端资源响应、非 root 用户及 SIGTERM 正常退出；Compose 发布验证覆盖容器名称与旧数据卷复用。
