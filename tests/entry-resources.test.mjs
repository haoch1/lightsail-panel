import assert from "node:assert/strict";
import test from "node:test";
import { entryResources } from "../src/lib/entry-resources.ts";
import { ResourceCache } from "../src/lib/resource-cache.ts";
import { cachedInstanceScan } from "../src/lib/instance-scan.ts";
import { monthlyTrafficPath, pricePath } from "../src/lib/instance-usage.ts";
import { snapshotKey } from "../server/resource-snapshots.mjs";

const account = { id: "qa", name: "QA", region: "ap-southeast-1" };
const instance = {
  id: "one",
  accountId: account.id,
  region: account.region,
  instanceType: "micro",
};
const scope = { accountId: account.id, region: account.region };

test("entry snapshots hydrate scan, usage, ports and static IP request identities before the first render", () => {
  const cache = new ResourceCache();
  const values = [
    [
      "/instances",
      scope,
      { items: [instance], errors: [], scanned: 1, at: "known" },
    ],
    [
      "/regions",
      { accountId: account.id },
      { items: [{ id: account.region }] },
    ],
    ["/bundles", scope, { types: [{ id: "micro", price: 7, transfer: 2048 }] }],
    [
      "/ports",
      { ...scope, id: "one" },
      { items: [{ protocol: "tcp", fromPort: 22 }] },
    ],
    [
      "/traffic",
      { ...scope, id: "one", utcOffsetMinutes: "480" },
      { totals: { combined: 22 } },
    ],
    [
      "/static-ips",
      scope,
      { items: [{ name: "ip", ipAddress: "198.51.100.1" }], at: "known" },
    ],
  ].map(([path, query, value]) => [snapshotKey(path, query), value]);
  cache.seedAll(entryResources(values, [account], 480));
  assert.equal(
    cachedInstanceScan(cache, {
      accounts: [account],
      accountId: "all",
      region: "all",
    }).items[0].id,
    "one",
  );
  assert.equal(cache.peek(pricePath(instance)).types[0].price, 7);
  assert.equal(
    cache.peek(monthlyTrafficPath(instance, 480)).totals.combined,
    22,
  );
  assert.equal(
    cache.peek(
      "/ports?accountId=qa&region=ap-southeast-1&service=lightsail&id=one",
    ).items.length,
    1,
  );
  assert.deepEqual(
    cache.peek("/static-ips?accountId=qa&region=ap-southeast-1").items[0],
    {
      name: "ip",
      ipAddress: "198.51.100.1",
      accountId: "qa",
      accountName: "QA",
      region: account.region,
    },
  );
});

test("entry resources exclude removed accounts, different traffic timezones and malformed or unsupported keys", () => {
  const rows = [
    [
      snapshotKey("/traffic", { ...scope, id: "one", utcOffsetMinutes: "0" }),
      {},
    ],
    [snapshotKey("/instances", { ...scope, accountId: "removed" }), {}],
    [snapshotKey("/instances", { ...scope, region: "all" }), {}],
    [snapshotKey("/ssh-access", scope), {}],
    [snapshotKey("/ports", scope), {}],
    [snapshotKey("/instances", scope), null],
    null,
    [42, {}],
  ];
  assert.deepEqual(entryResources(rows, [account], 480), []);
});

test("bulk hydration persists once, respects server expiry and detaches older pending responses", async () => {
  let saved = "[]",
    writes = 0,
    resolve;
  const cache = new ResourceCache(100, () => 1000);
  cache.restore(
    {
      getItem: () => saved,
      setItem: (_k, value) => {
        saved = value;
        writes++;
      },
      removeItem: () => {},
    },
    "qa",
  );
  const path =
    "/instances?accountId=qa&region=ap-southeast-1&service=lightsail";
  const pending = cache.load(
    path,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  cache.seedAll([
    [path, { items: [instance], cacheExpiresAt: 2000 }],
    ["/ports?qa", { items: [], cacheExpiresAt: 500 }],
  ]);
  assert.equal(writes, 1);
  assert.equal(cache.peek(path).items.length, 1);
  assert.equal(cache.peek("/ports?qa"), undefined);
  assert.deepEqual(cache.peek("/ports?qa", true).items, []);
  resolve({ items: [] });
  await pending;
  assert.equal(cache.peek(path).items.length, 1);
  assert.equal(writes, 1);
});
