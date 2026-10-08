import assert from "node:assert/strict";
import test from "node:test";
import { AwsGateway } from "../server/aws.mjs";
import { aggregateTraffic, trafficRange } from "../shared/traffic.mjs";
import {
  loadInstanceScan,
  cachedInstanceScan,
} from "../src/lib/instance-scan.ts";
import { ResourceCache } from "../src/lib/resource-cache.ts";
import { launch as launchInput } from "../server/validation.mjs";

test("new instances use the regional default key and auto-select an actual available zone", async () => {
  const gateway = new AwsGateway({ account: () => ({ id: "account" }) });
  gateway.catalog = async () => ({ images: [{ id: "debian_13" }], types: [{ id: "micro" }], zones: ["us-east-1b"] });
  const input = { accountId: "account", service: "lightsail", region: "us-east-1", imageId: "debian_13", instanceType: "micro", name: "example", count: 1, userData: "", token: "00000000-0000-4000-8000-000000000000" };
  let request;
  gateway.send = async (_a, _s, _r, command, body) => { request = { command, body }; return {}; };
  await gateway.launch(launchInput.parse(input));
  assert.equal(request.command, "CreateInstances");
  assert.equal(request.body.availabilityZone, "us-east-1b");
  assert.equal(Object.hasOwn(request.body, "keyPairName"), false);
  assert.equal(launchInput.safeParse({ ...input, keyName: "custom-key" }).success, false);
  await assert.rejects(gateway.launch({ ...input, keyName: "custom-key" }), /仅支持默认/);
});

test("regional catalogs use the selected endpoint for zones and cache each endpoint separately", async () => {
  const account = { id: "account", region: "ap-southeast-1" };
  const gateway = new AwsGateway({ account: () => account });
  const endpoints = [];
  gateway.send = async (_account, _service, region, command) => {
    if (command !== "GetRegions") return {};
    endpoints.push(region);
    return {
      regions: ["ap-southeast-1", "eu-west-1"].map((id) => ({
        name: id,
        availabilityZones:
          id === region
            ? [
                { zoneName: id + "b", state: "available" },
                { zoneName: id + "a", state: "unavailable" },
              ]
            : [],
      })),
    };
  };
  await gateway.regions(account);
  const catalog = await gateway.catalog(account.id, "lightsail", "eu-west-1");
  assert.deepEqual(catalog.zones, ["eu-west-1b"]);
  await gateway.catalog(account.id, "lightsail", "eu-west-1");
  assert.deepEqual(endpoints, ["ap-southeast-1", "eu-west-1"]);
});

test("today starts at local calendar midnight and excludes previous-day samples", () => {
  const now = new Date("2026-10-08T10:45:00Z");
  const window = trafficRange("today", now, 480);
  assert.equal(window.start.toISOString(), "2026-10-07T16:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-10-08T10:00:00.000Z");
  const result = aggregateTraffic(
    [
      [
        { timestamp: "2026-10-07T15:00:00Z", sum: 999 },
        { timestamp: "2026-10-07T16:00:00Z", sum: 10 },
        { timestamp: "2026-10-08T10:00:00Z", sum: 999 },
      ],
      [{ timestamp: "2026-10-08T09:00:00Z", sum: 20 }],
    ],
    window,
  );
  assert.deepEqual(result.totals, { inbound: 10, outbound: 20, combined: 30 });
  assert.equal(result.daily[0].date, "2026-10-08");
  assert.equal(result.utcOffsetMinutes, 480);
  assert.equal(
    trafficRange("today", now, -420).start.toISOString(),
    "2026-10-08T07:00:00.000Z",
  );
  const midnight = trafficRange("today", new Date("2026-10-07T16:15:00Z"), 480);
  assert.equal(midnight.start.getTime(), midnight.end.getTime());
  const halfHour = trafficRange("today", new Date("2026-10-07T18:35:00Z"), 330);
  assert.equal(halfHour.start.toISOString(), "2026-10-07T18:30:00.000Z");
  assert.ok(halfHour.start > halfHour.end);
});

test("only opt-in failures on an otherwise working account become unavailable-region notices; page revisits reuse results", async () => {
  const cache = new ResourceCache();
  const scope = {
    accounts: [{ id: "sg", name: "SG", region: "ap-southeast-1" }],
    accountId: "all",
    region: "all",
  };
  let calls = 0,
    broken = false,
    latest;
  const request = async (path) => {
    calls++;
    if (path.startsWith("/regions"))
      return { items: [{ id: "ap-southeast-1" }, { id: "ap-southeast-3" }] };
    const region = new URLSearchParams(path.split("?")[1]).get("region");
    if (broken || region === "ap-southeast-3")
      throw Error("UnrecognizedClientException: token invalid");
    return {
      items: [{ id: "existing", accountId: "sg", region }],
      errors: [],
      scanned: 1,
      at: new Date().toISOString(),
    };
  };
  await loadInstanceScan(cache, scope, request, (scan) => (latest = scan));
  assert.equal(latest.errors.length, 0);
  assert.equal(latest.unavailable.length, 1);
  assert.equal(latest.items.length, 1);
  const count = calls;
  for (let i = 0; i < 3; i++)
    await loadInstanceScan(cache, scope, request, () => {});
  assert.equal(calls, count);
  const specific = cachedInstanceScan(cache, {
    ...scope,
    region: "ap-southeast-3",
  });
  assert.equal(specific.errors.length, 1);
  broken = true;
  await loadInstanceScan(
    cache,
    scope,
    request,
    (scan) => (latest = scan),
    true,
  );
  assert.equal(latest.unavailable.length, 0);
  assert.equal(latest.errors.length, 2);
});
