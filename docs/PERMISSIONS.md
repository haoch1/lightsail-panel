# Lightsail 权限

资源管理调用 Lightsail，STS 用于身份验证。[iam-policy.json](iam-policy.json) 提供当前功能所需的统一 IAM 策略，部署时将该策略附加到面板使用的 IAM 用户。

- 只读：区域、实例、镜像、套餐、静态 IP、端口规则、操作结果与网络流量指标。
- 操作：创建、启停、重启和删除实例；静态 IP 分配与绑定；IPv6 启用/关闭；开放/关闭公网端口；默认 SSH 私钥下载。
- IPv6：`lightsail:SetIpAddressType` 将实例设为 `dualstack` 或 `ipv4`。仅 IPv6 实例关闭 IPv6 需要接受套餐变更，UI 勾选后才发送 `acceptBundleUpdate: true`；其他开关操作不接受套餐变更。关闭将释放原 IPv6 地址。
- 默认私钥下载需要 `lightsail:DownloadDefaultKeyPair`，已包含在统一策略中。该 API 在区域默认密钥不存在时会创建一个。私钥只返回给登录且通过 CSRF 校验的请求，不保存到数据库或日志。
- 创建实例包含 AWS 权限表列出的 `lightsail:TagResource` 依赖权限。面板当前不提供单独的标签编辑功能。
- 创建时可选的防火墙与静态 IP 配置在实例就绪后执行：`lightsail:PutInstancePublicPorts` 替换全部公网端口规则，`lightsail:AllocateStaticIp` 分配地址，`lightsail:AttachStaticIp` 绑定地址。仅 IPv6 实例不支持静态 IPv4；批量创建为每台实例分配独立地址。
- 网络配置进度持久化到 SQLite，面板重启后继续处理；前端进度查询只读取本地记录。配置失败保留已创建的实例，不自动重建。能够确认尚未绑定且未提交绑定请求的本次新分配地址会尝试释放；绑定结果不确定时保留地址并提示人工核对。
- 流量使用 `lightsail:GetInstanceMetricData`，无需额外授予 CloudWatch 权限。流量汇总使用 NetworkIn/NetworkOut、Sum、Bytes，历史按小时汇总，首尾不足一小时的部分按 5 分钟查询。自动关机使用策略已包含的 `lightsail:StopInstance`。流量包含所有网卡，不能直接换算为超额计费流量。
- 示例使用 `Resource: "*"`，便于初次验证；正式使用可按 Lightsail 支持的资源类型与标签条件收紧。
- 账户仅使用 Access Key ID / Secret Access Key，STS 用于身份查询。
- 此策略涵盖当前账户各区域的实例、静态 IP、防火墙、流量统计与默认密钥下载；不授予账单、快照、备份管理和其他 AWS 服务权限。
- 删除实例和静态 IP 都需要确认，删除资源还要求输入名称。脚本验证只读，不执行这些操作。

官方接口依据：[静态 IP 列表](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_GetStaticIps.html)、[开放端口](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_OpenInstancePublicPorts.html)、[关闭端口](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_CloseInstancePublicPorts.html)。

创建后网络配置依据：[CreateInstances](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_CreateInstances.html)、[PutInstancePublicPorts](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_PutInstancePublicPorts.html)、[AllocateStaticIp](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_AllocateStaticIp.html)、[AttachStaticIp](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_AttachStaticIp.html)。

权限动作与创建依赖依据：[Lightsail 服务授权参考](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lightsail.html)。`sts:GetCallerIdentity` 无需额外授权，策略显式列出此动作便于对应身份验证调用，参见 [STS 文档](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html)。

新增接口依据：[IPv6 地址类型](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_SetIpAddressType.html)。

SSH 官方依据：[DownloadDefaultKeyPair](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_DownloadDefaultKeyPair.html)、[Lightsail SSH 终端连接与默认私钥下载](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-ssh-using-terminal.html)。

流量依据：[指标及保留期](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-resource-health-metrics.html)、[流量额度与计费](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-data-transfer-allowance.html)。
