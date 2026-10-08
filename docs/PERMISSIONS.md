# Lightsail 权限

资源管理调用 Lightsail，STS 用于身份验证。[iam-policy.json](iam-policy.json) 提供当前功能所需的统一 IAM 策略，部署时将该策略附加到面板使用的 IAM 用户。

- 只读：区域、实例、镜像、套餐、静态 IP、端口规则、操作结果与网络流量指标。
- 操作：创建、启停、重启和删除实例；静态 IP 分配与绑定；IPv6 启用/关闭；开放/关闭公网端口；默认 SSH 私钥下载。
- IPv6：`lightsail:SetIpAddressType` 将实例设为 `dualstack` 或 `ipv4`。仅 IPv6 实例关闭 IPv6 需要接受套餐变更，UI 勾选后才发送 `acceptBundleUpdate: true`；其他开关操作不接受套餐变更。关闭将释放原 IPv6 地址。
- 默认私钥下载需要 `lightsail:DownloadDefaultKeyPair`，已包含在统一策略中。该 API 在区域默认密钥不存在时会创建一个。私钥只返回给登录且通过 CSRF 校验的请求，不保存到数据库或日志。
- 创建实例包含 AWS 权限表列出的 `lightsail:TagResource` 依赖权限。面板当前不提供单独的标签编辑功能。
- 流量使用 `lightsail:GetInstanceMetricData`，无需额外授予 CloudWatch 权限。流量汇总使用 NetworkIn/NetworkOut、Sum、Bytes，1 小时粒度，包含本月和近 30 天。流量包含所有网卡，不能直接换算为超额计费流量。
- 示例使用 `Resource: "*"`，便于初次验证；正式使用可按 Lightsail 支持的资源类型与标签条件收紧。
- 新账户仅使用 IAM Access Key / Secret Key，STS 用于身份查询；不添加临时凭证或 AssumeRole 设置。旧版本已保存的凭证保持兼容。
- 此策略涵盖当前账户各区域的实例、静态 IP、防火墙、流量统计与默认密钥下载；不授予账单、快照、备份、浏览器 SSH、自定义密钥、其他 AWS 服务或 AssumeRole 权限。历史账户使用 AssumeRole 时需另行迁移凭证。
- 删除实例和静态 IP 都需要确认，删除资源还要求输入名称。脚本验证只读，不执行这些操作。

官方接口依据：[静态 IP 列表](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_GetStaticIps.html)、[开放端口](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_OpenInstancePublicPorts.html)、[关闭端口](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_CloseInstancePublicPorts.html)。

权限动作与创建依赖依据：[Lightsail 服务授权参考](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lightsail.html)。`sts:GetCallerIdentity` 无需额外授权，策略显式列出此动作便于对应身份验证调用，参见 [STS 文档](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html)。

新增接口依据：[IPv6 地址类型](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_SetIpAddressType.html)。

SSH 官方依据：[DownloadDefaultKeyPair](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_DownloadDefaultKeyPair.html)、[Lightsail SSH 终端连接与默认私钥下载](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-ssh-using-terminal.html)。

流量依据：[指标及保留期](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-resource-health-metrics.html)、[流量额度与计费](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-data-transfer-allowance.html)。
