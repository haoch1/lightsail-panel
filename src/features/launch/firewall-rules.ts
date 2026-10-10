import type { PortInfo } from "../../../shared/types";
import { buildPortRule } from "../firewall/model.ts";
import { portRuleCovered } from "../../../shared/firewall.ts";

export function defaultLaunchFirewall(network: string): PortInfo[] {
  return [
    buildPortRule(
      { preset: "all", protocol: "all", from: 0, to: 65535, sources: "" },
      { ipAddressType: network },
    ),
  ];
}

function coversRule(broad: PortInfo, narrow: PortInfo): boolean {
  return portRuleCovered([broad], narrow);
}

// Remove only rules fully covered in both protocol/ports and every source family.
export function addLaunchFirewallRule(
  rules: PortInfo[],
  rule: PortInfo,
): PortInfo[] {
  if (rules.some((existing) => coversRule(existing, rule))) return rules;
  return [...rules.filter((existing) => !coversRule(rule, existing)), rule];
}
