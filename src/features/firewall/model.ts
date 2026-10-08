import type { Instance, PortInfo } from "../../../shared/types";
import { allPublicSources, firewallPresets } from "./presets.ts";
export const sourceTokens = (text: string) => [
  ...new Set(
    text
      .trim()
      .split(/[\s,，]+/)
      .filter(Boolean),
  ),
];
export function toggleSource(text: string, source: string, enabled: boolean) {
  return [
    ...sourceTokens(text).filter((s) => s !== source),
    ...(enabled ? [source] : []),
  ].join(", ");
}
export function buildPortRule(
  form: {
    preset: string;
    protocol: string;
    from: number;
    to: number;
    sources: string;
  },
  instance: Pick<Instance, "ipAddressType" | "ipv6">,
): PortInfo {
  const preset = firewallPresets.find((p) => p.id === form.preset);
  const protocol = preset?.protocol || form.protocol;
  const fromPort = preset?.from ?? form.from,
    toPort = preset?.to ?? form.to;
  const icmp = protocol === "icmp" || protocol === "icmpv6";
  if (
    !Number.isInteger(fromPort) ||
    !Number.isInteger(toPort) ||
    (icmp
      ? fromPort < -1 ||
        toPort < -1 ||
        fromPort > 255 ||
        toPort > 255 ||
        (fromPort === -1 && toPort !== -1)
      : fromPort < 0 || toPort > 65535 || fromPort > toPort)
  )
    throw Error(
      icmp
        ? "ICMP 类型和代码须为 -1–255；所有类型请同时使用 -1。"
        : "端口须为 0–65535，结束端口不能小于起始端口。",
    );
  const sources = sourceTokens(
    protocol === "all"
      ? allPublicSources(instance.ipAddressType, !!instance.ipv6?.length)
      : form.sources,
  ).map((s) => (s.includes("/") ? s : s + (s.includes(":") ? "/128" : "/32")));
  if (!sources.length) throw Error("请填写来源，或勾选所有 IPv4 / IPv6。");
  const cidrs = sources.filter((s) => !s.includes(":")),
    ipv6Cidrs = sources.filter((s) => s.includes(":"));
  if (
    (instance.ipAddressType === "ipv6" || protocol === "icmpv6") &&
    cidrs.length
  )
    throw Error("此规则只能使用 IPv6 来源。");
  if (
    ((instance.ipAddressType === "ipv4" && !instance.ipv6?.length) ||
      protocol === "icmp") &&
    ipv6Cidrs.length
  )
    throw Error("此规则只能使用 IPv4 来源；双栈规则请先启用 IPv6。");
  return {
    protocol,
    fromPort,
    toPort,
    ...(cidrs.length ? { cidrs } : {}),
    ...(ipv6Cidrs.length ? { ipv6Cidrs } : {}),
  };
}
