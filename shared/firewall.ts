import type { PortInfo } from "./types.ts";

const protocols: Record<string, string> = {
  "-1": "all",
  "6": "tcp",
  "17": "udp",
  "1": "icmp",
  "58": "icmpv6",
};
export const normalizeProtocol = (value: string | number) => {
  const key = String(value).toLowerCase();
  return Object.hasOwn(protocols, key) ? protocols[key] : key;
};
export const normalizePortRule = (rule: PortInfo): PortInfo => ({
  ...rule,
  protocol: normalizeProtocol(rule.protocol),
});
export const protocolLabel = (value: string) =>
  normalizeProtocol(value) === "all"
    ? "全部"
    : normalizeProtocol(value).toUpperCase();

function network(cidr: string) {
  const [address, prefix] = cidr.toLowerCase().split("/");
  const ipv4 = (ip: string) => {
    const parts = ip.split(".");
    if (
      parts.length !== 4 ||
      parts.some((p) => !/^\d{1,3}$/.test(p) || +p > 255)
    )
      throw Error("Invalid IPv4");
    return parts.reduce((n, p) => (n << 8n) | BigInt(p), 0n);
  };
  try {
    const bits = address.includes(":") ? 128 : 32;
    const length = prefix === undefined ? bits : Number(prefix);
    if (!Number.isInteger(length) || length < 0 || length > bits) return;
    let value: bigint;
    if (bits === 32) value = ipv4(address);
    else {
      let ip = address;
      if (ip.includes(".")) {
        const at = ip.lastIndexOf(":");
        const tail = ipv4(ip.slice(at + 1));
        ip =
          ip.slice(0, at + 1) +
          (tail >> 16n).toString(16) +
          ":" +
          (tail & 65535n).toString(16);
      }
      const halves = ip.split("::");
      if (halves.length > 2) return;
      const left = halves[0] ? halves[0].split(":") : [];
      const right = halves[1] ? halves[1].split(":") : [];
      const missing = 8 - left.length - right.length;
      if (halves.length === 1 ? missing !== 0 : missing < 1) return;
      const words = [...left, ...Array(missing).fill("0"), ...right];
      if (words.some((p) => !/^[\da-f]{1,4}$/.test(p))) return;
      value = words.reduce((n, p) => (n << 16n) | BigInt("0x" + p), 0n);
    }
    return { value, bits, length };
  } catch {
    return;
  }
}
export function cidrContains(broad: string, narrow: string): boolean {
  const a = network(broad),
    b = network(narrow);
  if (!a || !b || a.bits !== b.bits || a.length > b.length)
    return broad === narrow;
  const shift = BigInt(a.bits - a.length);
  return a.value >> shift === b.value >> shift;
}
const sources = (rule: PortInfo) =>
  (["cidrs", "ipv6Cidrs", "cidrListAliases"] as const).flatMap((field) =>
    (rule[field] || []).map((value) => ({ field, value })),
  );
function coversPorts(broad: PortInfo, narrow: PortInfo) {
  if (broad.protocol === "all") return true;
  if (broad.protocol !== narrow.protocol) return false;
  if (broad.protocol === "icmp" || broad.protocol === "icmpv6")
    return (
      (broad.fromPort === -1 || broad.fromPort === narrow.fromPort) &&
      (broad.toPort === -1 || broad.toPort === narrow.toPort)
    );
  return broad.fromPort <= narrow.fromPort && broad.toPort >= narrow.toPort;
}
/** Every requested source must be allowed; one IP family cannot stand in for another. */
export function portRuleCovered(
  rules: PortInfo[],
  expected: PortInfo,
): boolean {
  const wanted = normalizePortRule(expected);
  const available = rules
    .map(normalizePortRule)
    .filter((r) => coversPorts(r, wanted));
  const requested = sources(wanted);
  return (
    !!requested.length &&
    requested.every(({ field, value }) =>
      available.some((r) =>
        (r[field] || []).some((source) =>
          field === "cidrListAliases"
            ? source === value
            : cidrContains(source, value),
        ),
      ),
    )
  );
}
/** Closing a rule removes that protocol/range and source, not a broader independent rule. */
export function portRulePresent(
  rules: PortInfo[],
  expected: PortInfo,
): boolean {
  const wanted = normalizePortRule(expected);
  const matching = rules
    .map(normalizePortRule)
    .filter(
      (r) =>
        r.protocol === wanted.protocol &&
        r.fromPort === wanted.fromPort &&
        r.toPort === wanted.toPort,
    );
  const requested = sources(wanted);
  return requested.length
    ? requested.some(({ field, value }) =>
        matching.some((r) =>
          (r[field] || []).some((source) =>
            field === "cidrListAliases"
              ? source === value
              : cidrContains(source, value) && cidrContains(value, source),
          ),
        ),
      )
    : !!matching.length;
}
