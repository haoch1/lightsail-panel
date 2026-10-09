import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { AwsGateway } from "../server/aws.mjs";
import { Store } from "../server/store.mjs";
import { chartExtent, linePath } from "../src/components/charts/geometry.ts";
import { buildPortRule, toggleSource } from "../src/features/firewall/model.ts";
import { bytes, count, duration, percent } from "../src/lib/format.ts";
import { ResourceCache } from "../src/lib/resource-cache.ts";

const root = resolve("../aws-panel-reference");
mkdirSync(root, { recursive: true });
const target = {
  accountId: "test-account",
  service: "lightsail",
  region: "ap-northeast-1",
  id: "test-instance",
};
function fixture(t) {
  const directory = mkdtempSync(join(root, "polish-test-"));
  const store = new Store(directory);
  const account = store.saveAccount(
    { name: "test", region: target.region },
    { authType: "default" },
  );
  const credentials = store.createSession(),
    owner = store.session(credentials.token);
  t.after(() => {
    store.close();
    assert.ok(directory.startsWith(root + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    store,
    account,
    directory,
    credentials,
    owner,
    gateway: new AwsGateway(store),
  };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

test("static IP allocation uses the selected account and region instead of account defaults", async (t) => {
  const { store, gateway } = fixture(t);
  const selected = store.saveAccount(
    { name: "second-account", region: "eu-west-1" },
    { authType: "default" },
  );
  const calls = [];
  gateway.send = async (account, service, region, command, input) => {
    calls.push({ accountId: account.id, service, region, command, input });
    return { operations: [{ id: "allocate-operation" }] };
  };
  const result = await gateway.staticIpOperation({
    accountId: selected.id,
    region: "ap-southeast-1",
    name: "chosen-singapore-ip",
    action: "allocate",
  });
  assert.deepEqual(result.operations, [{ id: "allocate-operation" }]);
  assert.deepEqual(calls, [
    {
      accountId: selected.id,
      service: "lightsail",
      region: "ap-southeast-1",
      command: "AllocateStaticIp",
      input: { staticIpName: "chosen-singapore-ip" },
    },
  ]);
});

test("GET cache shares in-flight requests, expires, and manual refresh bypasses old data", async () => {
  let now = 100,
    calls = 0;
  const cache = new ResourceCache(15, () => now),
    loading = deferred();
  const loader = () => {
    calls++;
    return loading.promise;
  };
  const a = cache.load("instances", loader),
    b = cache.load("instances", loader);
  assert.equal(calls, 1);
  loading.resolve({ revision: 1 });
  assert.deepEqual(await a, await b);
  await cache.load("instances", loader);
  assert.equal(calls, 1);
  await cache.load(
    "instances",
    async () => {
      calls++;
      return { revision: 2 };
    },
    true,
  );
  assert.equal(cache.peek("instances").revision, 2);
  assert.equal(calls, 2);
  now += 16;
  assert.equal(cache.peek("instances"), undefined);
  await cache.load("instances", async () => {
    calls++;
    return { revision: 3 };
  });
  assert.equal(calls, 3);
});
test("invalidated and superseded GET requests cannot poison a new cache entry", async () => {
  const cache = new ResourceCache(),
    first = deferred(),
    old = cache.load("rows", () => first.promise);
  cache.clear();
  await cache.load("rows", async () => "after-write");
  first.resolve("before-write");
  await old;
  assert.equal(cache.peek("rows"), "after-write");
  const pending = deferred(),
    refreshed = cache.load("rows", () => pending.promise, true);
  await cache.load("rows", async () => "latest", true);
  pending.resolve("earlier");
  await refreshed;
  assert.equal(cache.peek("rows"), "latest");
  await assert.rejects(
    cache.load("failure", async () => {
      throw Error("network");
    }),
  );
  assert.equal(
    await cache.load("failure", async () => "recovered"),
    "recovered",
  );
});
test("custom firewall rules support ranges and concurrent IPv4/IPv6 sources", () => {
  const dual = { ipAddressType: "dualstack", ipv6: ["2001:db8::1"] };
  const sources = toggleSource("203.0.113.8", "0.0.0.0/0", true);
  const both = toggleSource(sources, "::/0", true);
  const rule = buildPortRule(
    { preset: "custom", protocol: "tcp", from: 8000, to: 8100, sources: both },
    dual,
  );
  assert.deepEqual(rule, {
    protocol: "tcp",
    fromPort: 8000,
    toPort: 8100,
    cidrs: ["203.0.113.8/32", "0.0.0.0/0"],
    ipv6Cidrs: ["::/0"],
  });
  assert.equal(toggleSource("::/0, ::/0", "::/0", true), "::/0");
  assert.equal(toggleSource(both, "::/0", false), sources);
  assert.equal(
    buildPortRule(
      {
        preset: "custom",
        protocol: "udp",
        from: 53,
        to: 53,
        sources: "2001:db8::1",
      },
      dual,
    ).ipv6Cidrs[0],
    "2001:db8::1/128",
  );
});
test("firewall presets remain three choices; all-protocol sources are derived automatically", () => {
  const rule = buildPortRule(
    { preset: "all", protocol: "tcp", from: 22, to: 22, sources: "" },
    { ipAddressType: "dualstack" },
  );
  assert.deepEqual(rule, {
    protocol: "all",
    fromPort: 0,
    toPort: 65535,
    cidrs: ["0.0.0.0/0"],
    ipv6Cidrs: ["::/0"],
  });
  const form = {
    preset: "custom",
    protocol: "tcp",
    from: 443,
    to: 80,
    sources: "0.0.0.0/0",
  };
  assert.throws(
    () => buildPortRule(form, { ipAddressType: "dualstack" }),
    /结束端口/,
  );
  assert.throws(
    () => buildPortRule({ ...form, to: 443, from: NaN }, {}),
    /端口/,
  );
  assert.throws(
    () =>
      buildPortRule(
        { ...form, to: 443, sources: "::/0" },
        { ipAddressType: "ipv4" },
      ),
    /启用 IPv6/,
  );
  assert.throws(
    () => buildPortRule({ ...form, protocol: "icmp", from: -1, to: 8 }, {}),
    /ICMP/,
  );
});
test("chart geometry uses explicit gaps and steps without inventing values or smoothing", () => {
  assert.equal(
    linePath(
      [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ],
      true,
    ),
    "M0.00 1.00 H1.00 V2.00",
  );
  const gap = linePath([
    { x: 0, y: 1 },
    { x: 1, y: null },
    { x: 2, y: 3 },
  ]);
  assert.equal(gap, "M0.00 1.00  M2.00 3.00");
  const series = [{ key: "value", label: "test", color: "black" }];
  const [min, max] = chartExtent(
    [
      { at: "x", value: -2 },
      { at: "y", value: 5 },
    ],
    series,
  );
  assert.ok(min < -2 && max > 5);
  assert.deepEqual(chartExtent([], series, [0, 100]), [0, 100]);
});
test("monitoring formatting uses percentage, byte, duration, and integer-count units", () => {
  assert.equal(percent(18.25), "18.25%");
  assert.equal(bytes(1024), "1.00 KiB");
  assert.equal(bytes(0), "0.00 B");
  assert.equal(bytes(0.6), "0.60 B");
  assert.equal(duration(7200), "2.00 小时");
  assert.equal(duration(90), "1.50 分钟");
  assert.equal(count(1200), "1,200 次");
  assert.equal(count(0), "0 次");
});
