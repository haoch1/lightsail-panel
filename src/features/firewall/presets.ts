export const firewallPresets = [
  {
    id: "all-tcp",
    name: "所有 TCP",
    group: "一般",
    protocol: "tcp",
    from: 0,
    to: 65535,
  },
  {
    id: "all-udp",
    name: "所有 UDP",
    group: "一般",
    protocol: "udp",
    from: 0,
    to: 65535,
  },
  {
    id: "all",
    name: "所有协议",
    group: "一般",
    protocol: "all",
    from: 0,
    to: 65535,
  },
] as const;
export function allPublicSources(ipAddressType?: string, hasIpv6 = false) {
  return [
    ipAddressType !== "ipv6" ? "0.0.0.0/0" : "",
    ipAddressType === "ipv6" || ipAddressType === "dualstack" || hasIpv6
      ? "::/0"
      : "",
  ]
    .filter(Boolean)
    .join(",");
}
export function portLabel(protocol: string, from: number, to: number) {
  if (protocol === "all") return "全部";
  if (protocol === "icmp" || protocol === "icmpv6")
    return from === -1
      ? "所有类型 / 代码"
      : `类型 ${from} · 代码 ${to === -1 ? "全部" : to}`;
  return from === to ? String(from) : `${from}–${to}`;
}
export function applicationLabel(protocol: string, from: number, to: number) {
  return (
    firewallPresets.find(
      (p) => p.protocol === protocol && p.from === from && p.to === to,
    )?.name || (protocol === "icmpv6" ? "ICMPv6" : "自定义")
  );
}
