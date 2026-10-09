import type { PortInfo } from "../../../shared/types";
import { buildPortRule } from "../firewall/model.ts";

export function defaultLaunchFirewall(network: string): PortInfo[] {
  return [
    buildPortRule(
      { preset: "all", protocol: "all", from: 0, to: 65535, sources: "" },
      { ipAddressType: network },
    ),
  ];
}

function coversRule(broad: PortInfo, narrow: PortInfo): boolean {
  if (broad.protocol !== "all") {
    if (broad.protocol !== narrow.protocol) return false;
    if (broad.protocol === "icmp" || broad.protocol === "icmpv6") {
      if (broad.fromPort !== -1 && broad.fromPort !== narrow.fromPort)
        return false;
      if (broad.toPort !== -1 && broad.toPort !== narrow.toPort) return false;
    } else if (broad.fromPort > narrow.fromPort || broad.toPort < narrow.toPort)
      return false;
  }
  const sourcesCovered = (
    wider: string[] = [],
    smaller: string[] = [],
    all?: string,
  ) =>
    smaller.every(
      (source) => wider.includes(source) || (!!all && wider.includes(all)),
    );
  return (
    sourcesCovered(broad.cidrs, narrow.cidrs, "0.0.0.0/0") &&
    sourcesCovered(broad.ipv6Cidrs, narrow.ipv6Cidrs, "::/0") &&
    sourcesCovered(broad.cidrListAliases, narrow.cidrListAliases)
  );
}

// Remove only rules fully covered in both protocol/ports and every source family.
export function addLaunchFirewallRule(
  rules: PortInfo[],
  rule: PortInfo,
): PortInfo[] {
  if (rules.some((existing) => coversRule(existing, rule))) return rules;
  return [...rules.filter((existing) => !coversRule(rule, existing)), rule];
}
