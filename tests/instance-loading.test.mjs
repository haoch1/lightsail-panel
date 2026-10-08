import assert from "node:assert/strict";
import test from "node:test";
import {
  cachedInstanceScan,
  loadInstanceScan,
} from "../src/lib/instance-scan.ts";
import { ResourceCache } from "../src/lib/resource-cache.ts";
import { account as accountInput } from "../server/validation.mjs";

const accounts = [
  { id: "sg", name: "SG", region: "ap-southeast-1" },
  { id: "other", name: "Other", region: "us-east-1" },
];
const scope = (accountId = "all", region = "ap-southeast-1") => ({
  accounts,
  accountId,
  region,
});
const scan = (accountId, region, items = ["server"]) => ({
  items: items.map((id) => ({ id, accountId, region })),
  errors: [],
  scanned: 1,
  at: "2026-10-08T10:00:00Z",
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

test("all accounts publish ready instances before a slow account finishes and share pending requests", async () => {
  const cache = new ResourceCache();
  const slow = deferred();
  const ready = deferred();
  const calls = [];
  const read = async (path) => {
    const query = new URLSearchParams(path.split("?")[1]);
    const id = query.get("accountId");
    calls.push(id);
    return id === "sg" ? scan(id, query.get("region")) : slow.promise;
  };
  let latest;
  const loading = loadInstanceScan(cache, scope(), read, (data, pending) => {
    latest = { data, pending };
    if (data?.items.some((row) => row.accountId === "sg")) ready.resolve();
  });
  await ready.promise;
  assert.equal(latest.pending, true);
  assert.equal(latest.data.items[0].accountId, "sg");
  assert.equal(cachedInstanceScan(cache, scope("sg")).items.length, 1);
  assert.equal(cachedInstanceScan(cache, scope("other")), undefined);
  const single = loadInstanceScan(cache, scope("other"), read, () => {});
  slow.resolve(scan("other", "ap-southeast-1"));
  await Promise.all([loading, single]);
  assert.deepEqual(calls.sort(), ["other", "sg"]);
  assert.equal(latest.pending, false);
  assert.equal(latest.data.items.length, 2);
});

test("all-region discovery does not delay the default region; cache filters accounts and regions", async () => {
  let now = 100;
  const cache = new ResourceCache(15, () => now);
  const discovery = deferred();
  const ready = deferred();
  const calls = [];
  const read = async (path) => {
    calls.push(path);
    if (path.startsWith("/regions")) return discovery.promise;
    const query = new URLSearchParams(path.split("?")[1]);
    return scan(query.get("accountId"), query.get("region"));
  };
  let latest;
  const loading = loadInstanceScan(cache, scope("sg", "all"), read, (data) => {
    latest = data;
    if (data?.items.length) ready.resolve();
  });
  await ready.promise;
  assert.equal(latest.items[0].region, "ap-southeast-1");
  discovery.resolve({
    items: [{ id: "ap-southeast-1" }, { id: "us-east-1" }],
  });
  await loading;
  assert.equal(latest.items.length, 2);
  assert.equal(
    calls.filter((path) => path.includes("region=ap-southeast-1")).length,
    1,
  );
  assert.equal(
    cachedInstanceScan(cache, scope("sg", "us-east-1")).items.length,
    1,
  );
  assert.equal(cachedInstanceScan(cache, scope("other", "all")), undefined);
  now += 300_001;
  assert.equal(cache.matching("/instances?").length, 0);
  assert.equal(cachedInstanceScan(cache, scope()).items.length, 1);
  const before = calls.length;
  await loadInstanceScan(cache, scope("sg", "all"), read, () => {});
  assert.equal(calls.length - before, 2);
  cache.clear();
  assert.equal(cachedInstanceScan(cache, scope()), undefined);
});

test("manual refresh removes deleted instances and partial failures preserve successful accounts", async () => {
  const cache = new ResourceCache();
  const read = async (path) => {
    const query = new URLSearchParams(path.split("?")[1]);
    return scan(query.get("accountId"), query.get("region"));
  };
  await loadInstanceScan(cache, scope(), read, () => {});
  let latest;
  await loadInstanceScan(
    cache,
    scope(),
    async (path) => {
      const query = new URLSearchParams(path.split("?")[1]);
      if (query.get("accountId") === "other") throw Error("AccessDenied");
      return scan("sg", query.get("region"), []);
    },
    (data) => (latest = data),
    true,
  );
  assert.equal(
    latest.items.some((row) => row.accountId === "sg"),
    false,
  );
  assert.equal(latest.errors[0].account, "Other");
  assert.equal(latest.errors[0].message, "AccessDenied");
});

test("account API accepts only name and access keys and chooses an internal SDK endpoint", () => {
  const input = accountInput.parse({
    name: "SG",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "test-secret",
  });
  assert.equal(input.authType, "keys");
  assert.equal(input.region, "us-east-1");
  assert.equal(input.sessionToken, undefined);
  assert.equal(input.roleArn, undefined);
  assert.equal(input.externalId, undefined);
});

test("multi-account and multi-region loading keeps total request concurrency bounded", async () => {
  const cache = new ResourceCache();
  let active = 0;
  let maximum = 0;
  let latest;
  await loadInstanceScan(
    cache,
    scope("all", "all"),
    async (path) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      const query = new URLSearchParams(path.split("?")[1]);
      if (path.startsWith("/regions"))
        return {
          items: Array.from({ length: 8 }, (_, index) => ({
            id: `region-${index}`,
          })),
        };
      return scan(query.get("accountId"), query.get("region"));
    },
    (data) => (latest = data),
  );
  assert.equal(maximum, 4);
  assert.equal(active, 0);
  assert.equal(latest.items.length, 18);
});
