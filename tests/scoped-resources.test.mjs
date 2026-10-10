import assert from "node:assert/strict";
import test from "node:test";
import { ResourceCache } from "../src/lib/resource-cache.ts";
import {
  cachedResourceScan,
  loadResourceScan,
} from "../src/lib/resource-scan.ts";
import { staticIpSource } from "../src/lib/static-ip-scan.ts";
import {
  monthlyTrafficPath,
  instanceBundle,
} from "../src/lib/instance-usage.ts";
import { menuPosition } from "../src/lib/menu-position.ts";
import { aggregateTraffic, trafficRange } from "../shared/traffic.mjs";
import { AwsGateway } from "../server/aws.mjs";

test("static IPs aggregate all accounts and regions without merging equal resource names", async () => {
  const scope = {
    accounts: [
      { id: "a", name: "A", region: "us-east-1" },
      { id: "b", name: "B", region: "ap-southeast-1" },
    ],
    accountId: "all",
    region: "all",
  };
  const cache = new ResourceCache();
  let calls = 0,
    latest;
  const request = async (path) => {
    calls++;
    if (path.startsWith("/regions?"))
      return { items: [{ id: "us-east-1" }, { id: "ap-southeast-1" }] };
    return {
      items: [
        { name: "same-name", ipAddress: "198.51.100.1", isAttached: false },
      ],
    };
  };
  await loadResourceScan(
    cache,
    scope,
    staticIpSource,
    request,
    (scan) => (latest = scan),
  );
  assert.equal(latest.items.length, 4);
  assert.equal(
    new Set(latest.items.map((ip) => `${ip.accountId}:${ip.region}:${ip.name}`))
      .size,
    4,
  );
  assert.equal(latest.scanned, 4);
  const filtered = cachedResourceScan(
    cache,
    { ...scope, accountId: "b", region: "us-east-1" },
    staticIpSource,
  );
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].accountId, "b");
  assert.equal(filtered.items[0].accountName, "B");
  assert.equal(filtered.items[0].region, "us-east-1");
  const before = calls;
  await loadResourceScan(cache, scope, staticIpSource, request, () => {});
  assert.equal(calls, before);
});

test("every traffic range uses the same local dates; today's daily row matches today's totals", () => {
  const now = new Date("2026-10-08T12:45:00Z");
  const expectations = {
    today: "2026-10-07T16:00:00.000Z",
    "7d": "2026-10-01T16:00:00.000Z",
    "30d": "2026-09-08T16:00:00.000Z",
    month: "2026-09-30T16:00:00.000Z",
  };
  const series = [0, 1].map((direction) =>
    Array.from({ length: 32 * 24 }, (_, n) => ({
      timestamp: new Date(now.getTime() - 45 * 60000 - (n + 1) * 3600000),
      sum: direction ? 20 : 10,
    })),
  );
  const today = aggregateTraffic(series, trafficRange("today", now, 480));
  for (const [range, start] of Object.entries(expectations)) {
    const window = trafficRange(range, now, 480);
    assert.equal(window.start.toISOString(), start);
    assert.equal(window.end.toISOString(), "2026-10-08T12:45:00.000Z");
    const result = aggregateTraffic(series, window);
    const row = result.daily.find((row) => row.date === "2026-10-08");
    assert.equal(row.inbound, today.totals.inbound);
    assert.equal(row.outbound, today.totals.outbound);
    assert.equal(
      result.daily.reduce((sum, row) => sum + row.inbound + row.outbound, 0),
      result.totals.combined,
    );
  }
  assert.equal(
    trafficRange(
      "month",
      new Date("2026-09-30T18:00:00Z"),
      480,
    ).start.toISOString(),
    "2026-09-30T16:00:00.000Z",
  );
  assert.equal(
    trafficRange(
      "7d",
      new Date("2026-10-08T12:45:00Z"),
      -420,
    ).start.toISOString(),
    "2026-10-02T07:00:00.000Z",
  );
});

test("list traffic uses the selected instance and calendar timezone; price matches its exact bundle", () => {
  const i = {
    accountId: "account",
    region: "ap-southeast-1",
    id: "instance",
    instanceType: "micro_3_0",
  };
  const params = new URLSearchParams(monthlyTrafficPath(i, 480).split("?")[1]);
  assert.equal(params.get("id"), "instance");
  assert.equal(params.get("range"), "month");
  assert.equal(params.get("utcOffsetMinutes"), "480");
  const catalog = {
    types: [
      { id: "micro_ipv6_3_0", price: 5 },
      { id: "micro_3_0", price: 7 },
    ],
  };
  assert.equal(instanceBundle(catalog, i).price, 7);
  assert.equal(
    instanceBundle(catalog, { ...i, instanceType: "unknown" }),
    undefined,
  );
});

test("creation submits the selected zone and refuses a zone from another region before sending", async () => {
  const gateway = new AwsGateway({ account: () => ({ id: "account" }) });
  gateway.catalog = async () => ({
    images: [{ id: "debian_13" }],
    types: [{ id: "micro_3_0" }],
    zones: ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"],
  });
  const input = {
    accountId: "account",
    region: "ap-southeast-1",
    service: "lightsail",
    imageId: "debian_13",
    instanceType: "micro_3_0",
    name: "example",
    count: 1,
    ipAddressType: "dualstack",
    zone: "ap-southeast-1c",
  };
  let calls = 0;
  gateway.send = async (_a, _s, _r, command, body) => {
    calls++;
    assert.equal(command, "CreateInstances");
    assert.equal(body.availabilityZone, input.zone);
    return {};
  };
  await gateway.launch(input);
  await assert.rejects(
    gateway.launch({ ...input, zone: "us-east-1a" }),
    /没有所选/,
  );
  assert.equal(calls, 1);
});

test("operation menus align with the trigger and use available space without covering it", () => {
  const viewport = { width: 1146, height: 704 };
  const below = menuPosition(
    { right: 1100, top: 200, bottom: 232 },
    233,
    400,
    viewport,
  );
  assert.equal(below.x, 867);
  assert.equal(below.y, 238);
  assert.ok(below.y + Math.min(400, below.maxHeight) <= 696);
  const above = menuPosition(
    { right: 1100, top: 540, bottom: 572 },
    233,
    400,
    viewport,
  );
  assert.equal(above.y, 134);
  const middle = menuPosition({ right: 380, top: 380, bottom: 412 }, 233, 440, {
    width: 390,
    height: 844,
  });
  assert.equal(middle.y, 418);
  assert.ok(middle.maxHeight < 440);
  assert.ok(middle.x >= 8 && middle.x + 233 <= 382);
});
