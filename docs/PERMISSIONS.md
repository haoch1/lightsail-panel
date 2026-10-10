# IAM 权限

[iam-policy.json](iam-policy.json) 定义面板所需的统一 IAM 策略，附加至面板使用的 IAM 用户。资源管理调用 Lightsail API，身份验证调用 STS。

## 权限范围

以下动作除 STS 外均使用 `lightsail:` 前缀。

| 功能              | 权限动作                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| 身份验证          | `sts:GetCallerIdentity`                                                                                  |
| 区域与创建目录    | `GetRegions`、`GetBlueprints`、`GetBundles`                                                              |
| 实例与操作查询    | `GetInstances`、`GetInstance`、`GetOperation`                                                            |
| 实例管理          | `CreateInstances`、`TagResource`、`StartInstance`、`StopInstance`、`RebootInstance`、`DeleteInstance`    |
| IPv6 配置         | `SetIpAddressType`                                                                                       |
| 静态 IP           | `GetStaticIps`、`GetStaticIp`、`AllocateStaticIp`、`AttachStaticIp`、`DetachStaticIp`、`ReleaseStaticIp` |
| 公网防火墙        | `GetInstancePortStates`、`OpenInstancePublicPorts`、`PutInstancePublicPorts`、`CloseInstancePublicPorts` |
| 流量统计          | `GetInstanceMetricData`                                                                                  |
| SSH 终端          | `GetInstance`、`GetInstanceAccessDetails`                                                                |
| 默认 SSH 私钥下载 | `DownloadDefaultKeyPair`                                                                                 |
| 自动关机          | `GetInstance`、`GetBundles`、`GetInstanceMetricData`、`StopInstance`                                     |

策略覆盖凭证所属账户各区域的实例、静态 IP、防火墙、流量和 SSH 功能，不授予账单、快照、备份管理或其他 AWS 服务权限。流量查询无需 CloudWatch 授权；会话管理与日志清理在本地执行，流量进度复用套餐和指标查询。

统一策略使用 `Resource: "*"`，可依据 Lightsail 支持的资源类型与标签条件限制授权范围。`sts:GetCallerIdentity` 无需额外授权，策略显式列出该动作以对应身份验证调用。

## 执行规则

- **实例创建：** `TagResource` 为创建操作的依赖权限。面板不提供独立标签编辑功能。
- **IPv6：** `SetIpAddressType` 设置 `dualstack` 或 `ipv4`。仅 IPv6 实例关闭 IPv6 涉及套餐变更，须确认后发送 `acceptBundleUpdate: true`；关闭会释放原地址。
- **创建后网络配置：** 实例就绪后，`PutInstancePublicPorts` 替换公网规则，`AllocateStaticIp` 和 `AttachStaticIp` 分配并绑定地址。批量创建按实例分配独立地址，仅 IPv6 实例不支持静态 IPv4。
- **网络配置失败：** 任务进度保存至 SQLite，服务重启后恢复执行。失败时保留实例；本次分配且确认未绑定、未提交绑定请求的地址尝试释放，绑定结果不确定时保留并提示核对。
- **流量：** 查询 `NetworkIn`、`NetworkOut` 的 `Sum` 值，单位为 `Bytes`。历史按小时汇总，首尾不足一小时的区间按 5 分钟查询。指标涵盖全部网卡，不等同于超额计费流量。
- **自动关机：** 确认实例身份与运行状态，按目标区域套餐的月流量额度判断阈值，达到后提交停止请求。
- **SSH 终端：** 临时私钥、证书、登录用户名和主机密钥来自 `GetInstanceAccessDetails`。凭证仅供服务端 OpenSSH 使用，连接结束后清理临时文件。
- **默认私钥下载：** `DownloadDefaultKeyPair` 在区域默认密钥不存在时创建密钥。下载须通过会话、来源和 CSRF 校验；私钥不写入数据库或日志。
- **删除与释放：** 删除实例和释放静态 IP 均须确认并核对资源名称。

## 官方参考

- [Lightsail 服务授权参考](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lightsail.html)
- [STS GetCallerIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html)
- [CreateInstances](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_CreateInstances.html)、[PutInstancePublicPorts](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_PutInstancePublicPorts.html)
- [静态 IP 查询](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_GetStaticIps.html)、[分配](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_AllocateStaticIp.html)、[绑定](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_AttachStaticIp.html)
- [公网端口开放](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_OpenInstancePublicPorts.html)、[关闭](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_CloseInstancePublicPorts.html)
- [SetIpAddressType](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_SetIpAddressType.html)
- [GetInstanceAccessDetails](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_GetInstanceAccessDetails.html)、[临时 SSH 凭证](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_InstanceAccessDetails.html)、[DownloadDefaultKeyPair](https://docs.aws.amazon.com/lightsail/2016-11-28/api-reference/API_DownloadDefaultKeyPair.html)
- [指标及保留期](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-resource-health-metrics.html)、[流量额度与计费](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-data-transfer-allowance.html)
