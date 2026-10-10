import { auditDefaultDetail } from "../shared/audit-actions.ts";
import { normalizePortRule } from "../shared/firewall.ts";

export function operationAuditAction(job) {
  return job.resource === "static-ips"
    ? `static-ip-${job.action}`
    : job.action || "launch";
}

function confirmedDetail(job, item) {
  if (item.detail) return item.detail;
  if (item.stage === "failed") return "操作失败，未返回错误详情";
  if (job.resource === "ports" && job.expectedPort) {
    const port = normalizePortRule(job.expectedPort);
    const protocol =
      port.protocol === "all" ? "所有协议" : port.protocol.toUpperCase();
    const range =
      port.fromPort === port.toPort
        ? String(port.fromPort)
        : `${port.fromPort}–${port.toPort}`;
    const sources = [
      ...(port.cidrs || []),
      ...(port.ipv6Cidrs || []),
      ...(port.cidrListAliases || []),
    ];
    return `已确认${job.close ? "关闭" : "开放"} ${protocol} ${range}；来源：${sources.join("、") || "未指定"}`;
  }
  if (job.resource === "static-ips") {
    if (job.action === "attach")
      return `已确认绑定至实例 ${job.targetInstance}`;
    return `${auditDefaultDetail(operationAuditAction(job), "success")}，资源状态已确认`;
  }
  if (job.action === "launch")
    return [
      "实例已运行",
      job.firewall ? "防火墙规则已配置" : "",
      job.allocateStaticIp ? `静态 IP ${item.staticIpName} 已绑定` : "",
    ]
      .filter(Boolean)
      .join("；");
  if (job.action === "rotate-ip" && job.staticIpName)
    return `已确认新静态 IP ${job.staticIpName} 绑定至实例`;
  return (
    {
      start: "实例状态已确认：运行中",
      stop: "实例状态已确认：已停止",
      reboot: "重启操作完成，实例状态已确认：运行中",
      terminate: "已确认实例删除",
      "enable-ipv6": "已确认启用 IPv6，公网 IPv6 地址已分配",
      "disable-ipv6": "已确认关闭 IPv6，公网 IPv6 地址已释放",
    }[job.action] || "资源状态已更新"
  );
}

export function operationAuditDetail(job) {
  return [
    job.instances
      .map(
        (item) =>
          `${job.instances.length > 1 ? item.name + "：" : ""}${confirmedDetail(job, item)}`,
      )
      .join("；"),
    job.auditNotice,
  ]
    .filter(Boolean)
    .join("；");
}
