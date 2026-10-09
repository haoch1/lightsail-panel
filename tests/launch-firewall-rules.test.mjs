import assert from "node:assert/strict";
import test from "node:test";
import {
  addLaunchFirewallRule,
  defaultLaunchFirewall,
} from "../src/features/launch/firewall-rules.ts";

const tcp = (fromPort, toPort = fromPort, sources = {}) => ({
  protocol: "tcp",
  fromPort,
  toPort,
  cidrs: ["0.0.0.0/0"],
  ipv6Cidrs: ["::/0"],
  ...sources,
});

test("launch firewall defaults to all protocols for the selected network families", () => {
  const [dual] = defaultLaunchFirewall("dualstack");
  assert.deepEqual(dual, {
    protocol: "all",
    fromPort: 0,
    toPort: 65535,
    cidrs: ["0.0.0.0/0"],
    ipv6Cidrs: ["::/0"],
  });
  assert.deepEqual(defaultLaunchFirewall("ipv6"), [
    { protocol: "all", fromPort: 0, toPort: 65535, ipv6Cidrs: ["::/0"] },
  ]);
  assert.deepEqual(defaultLaunchFirewall("ipv4"), [
    { protocol: "all", fromPort: 0, toPort: 65535, cidrs: ["0.0.0.0/0"] },
  ]);
});

test("adding all protocols replaces covered TCP, UDP and ICMP rules and prevents redundant additions", () => {
  const [all] = defaultLaunchFirewall("dualstack");
  const initial = [
    tcp(22),
    { ...tcp(53), protocol: "udp" },
    { protocol: "icmp", fromPort: -1, toPort: -1, cidrs: ["203.0.113.10/32"] },
  ];
  const result = addLaunchFirewallRule(initial, all);
  assert.deepEqual(result, [all]);
  assert.deepEqual(initial[0], tcp(22));
  assert.strictEqual(addLaunchFirewallRule(result, tcp(22)), result);
  assert.strictEqual(addLaunchFirewallRule(result, all), result);
});

test("coverage respects sources and preserves partially covered address families and aliases", () => {
  const [ipv4All] = defaultLaunchFirewall("ipv4");
  const dual = tcp(22);
  assert.deepEqual(addLaunchFirewallRule([dual], ipv4All), [dual, ipv4All]);
  const restrictedAll = { ...ipv4All, cidrs: ["203.0.113.0/24"] };
  const publicTcp = tcp(443, 443, { ipv6Cidrs: undefined });
  assert.deepEqual(addLaunchFirewallRule([publicTcp], restrictedAll), [
    publicTcp,
    restrictedAll,
  ]);
  const alias = {
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
    cidrListAliases: ["lightsail-connect"],
  };
  assert.deepEqual(addLaunchFirewallRule([alias], ipv4All), [alias, ipv4All]);
  const privateTcp = tcp(443, 443, {
    cidrs: ["198.51.100.8/32"],
    ipv6Cidrs: undefined,
  });
  assert.deepEqual(addLaunchFirewallRule([privateTcp], ipv4All), [ipv4All]);
});

test("same-protocol ranges replace fully covered ports but preserve distinct protocols and ICMP types", () => {
  const broad = tcp(8000, 8100);
  const udp = { ...tcp(8050), protocol: "udp" };
  assert.deepEqual(addLaunchFirewallRule([tcp(8000), tcp(8050), udp], broad), [
    udp,
    broad,
  ]);
  assert.deepEqual(addLaunchFirewallRule([broad], tcp(8100, 8200)), [
    broad,
    tcp(8100, 8200),
  ]);
  const echo = {
    protocol: "icmp",
    fromPort: 8,
    toPort: 0,
    cidrs: ["0.0.0.0/0"],
  };
  const allCodes = { ...echo, toPort: -1 };
  const otherType = { ...echo, fromPort: 3 };
  assert.deepEqual(addLaunchFirewallRule([echo, otherType], allCodes), [
    otherType,
    allCodes,
  ]);
});
