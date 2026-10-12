import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../server/store.mjs";
import {
  ResourceSnapshots,
  snapshotKey,
} from "../server/resource-snapshots.mjs";
import { AwsGateway } from "../server/aws.mjs";
import { createApp } from "../server/app.mjs";
import { trafficRange } from "../shared/traffic.mjs";

function fixture(t) {
  const root = resolve("../aws-panel-reference");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "snapshots-"));
  const store = new Store(dir);
  const stores = [store];
  const account = store.saveAccount(
    { name: "QA", region: "us-east-1" },
    { accessKeyId: "NEVER_SAVE_KEY", secretAccessKey: "NEVER_SAVE_SECRET" },
  );
  t.after(() => {
    for (const s of stores) s.close();
    assert.ok(dir.startsWith(root));
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, account, dir, stores };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test("entry hydration reads bounded authorized snapshots without AWS, excludes old traffic periods, and prioritizes existing instances", async (t) => {
  const { store, account } = fixture(t);
  const now = Date.parse("2026-10-12T01:00:00Z");
  const cache = new ResourceSnapshots(store, {}, { now: () => now });
  const query = { accountId: account.id, region: "us-east-1" };
  const add = (path, value, extra = {}) =>
    cache.entries.set(snapshotKey(path, { ...query, ...extra }), {
      value,
      expires: now - 1,
    });
  add("/instances", { items: [], errors: [] }, { region: "empty" });
  add("/instances", { items: [{ id: "one" }], errors: [] });
  add("/ports", { items: [{ protocol: "tcp" }] }, { id: "one" });
  add("/catalog", { images: [], types: [], zones: [] });
  add(
    "/traffic",
    { start: "2026-09-01T00:00:00.000Z", totals: {} },
    { id: "one", range: "month", utcOffsetMinutes: "0" },
  );
  add(
    "/traffic",
    {
      start: trafficRange("7d", new Date(now), 0).start.toISOString(),
      totals: {},
    },
    { id: "one", range: "7d", utcOffsetMinutes: "0" },
  );
  add(
    "/instances",
    { items: [{ id: "unauthorized" }] },
    { accountId: "removed" },
  );
  add("/ssh-access", { privateKey: "NEVER_EMBED" });
  const rows = cache.initial("/lightsail");
  assert.equal(rows[0][1].items[0].id, "one");
  assert.ok(rows[0][1].snapshotStale);
  assert.equal(cache.active, 0);
  assert.equal(cache.queue.length, 0);
  assert.ok(!JSON.stringify(rows).includes("unauthorized"));
  assert.ok(!JSON.stringify(rows).includes("NEVER_EMBED"));
  assert.ok(
    !rows.some(
      ([key]) => key.startsWith("/catalog?") || key.startsWith("/traffic?"),
    ),
  );
  assert.ok(
    cache
      .initial("/lightsail/launch")
      .some(([key]) => key.startsWith("/catalog?")),
  );
  assert.ok(
    cache
      .initial("/lightsail/traffic")
      .some(([key]) => key.startsWith("/traffic?")),
  );
  const bytes = Buffer.byteLength(JSON.stringify(rows[0]));
  assert.equal(cache.initial("/lightsail", bytes).length, 1);
  assert.deepEqual(cache.initial("/lightsail", 1), []);
});

test("durable snapshots serve expired data immediately, deduplicate refreshes, and survive a service restart", async (t) => {
  const { store, account, dir, stores } = fixture(t);
  let now = Date.parse("2026-10-12T01:01:00Z"),
    calls = 0;
  const req = {
    path: "/api/instances",
    query: { accountId: account.id, region: "us-east-1", service: "lightsail" },
  };
  const first = new ResourceSnapshots(store, {}, { now: () => now });
  await first.read(req, async () => ({
    items: [++calls],
    errors: [],
    at: new Date(now).toISOString(),
  }));
  const disk = new Store(dir);
  const restarted = new ResourceSnapshots(disk, {}, { now: () => now });
  stores.push(disk);
  now += 10 * 60_000;
  const pending = deferred();
  const load = async () => {
    calls++;
    await pending.promise;
    return { items: [2], errors: [], at: new Date(now).toISOString() };
  };
  const result = await restarted.read(req, load);
  assert.deepEqual(result.items, [1]);
  assert.equal(result.snapshotStale, true);
  assert.equal(result.cacheExpiresAt, now + 30_000);
  await restarted.read(req, load);
  assert.equal(calls, 2);
  pending.resolve();
  await restarted.entries.get(snapshotKey(req.path, req.query)).pending;
  assert.deepEqual((await restarted.read(req, load)).items, [2]);
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(store.snapshots()).includes("NEVER_SAVE"));
});

test("failed and partial cloud reads retain the last successful snapshot and its timestamp", async (t) => {
  const { store, account } = fixture(t);
  let now = 1000;
  const cache = new ResourceSnapshots(store, {}, { now: () => now });
  const key = snapshotKey("/instances", {
    accountId: account.id,
    region: "us-east-1",
  });
  await cache.load(key, async () => ({
    items: ["live"],
    errors: [],
    at: "original",
  }));
  now = 300000;
  const partial = await cache.load(
    key,
    async () => ({ items: [], errors: [{ message: "AWS unavailable" }] }),
    true,
  );
  assert.deepEqual(partial.items, ["live"]);
  assert.equal(partial.at, "original");
  assert.match(partial.errors[0].message, /AWS unavailable/);
  assert.equal(store.snapshots()[0].value.at, "original");
  const failed = await cache.load(
    key,
    async () => {
      throw Error("offline");
    },
    true,
  );
  assert.deepEqual(failed.items, ["live"]);
  assert.equal(failed.snapshotStale, true);
});

test("background collection discovers all regions, warms prices and traffic without HTTP clients, and is bounded", async (t) => {
  const { store, account } = fixture(t);
  let active = 0,
    peak = 0,
    calls = [];
  const now = Date.parse("2026-10-12T01:00:00Z");
  const track = async (label, value) => {
    active++;
    peak = Math.max(peak, active);
    calls.push(label);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return value;
  };
  const gateway = {
    regions: () =>
      track(
        "regions",
        Array.from({ length: 8 }, (_, i) => ({ id: "r-" + i })),
      ),
    scan: (ids, _service, region) =>
      track("instances:" + region, {
        items: region === account.region ? [{ id: "one" }] : [],
        errors: [],
        at: new Date(now).toISOString(),
      }),
    bundles: () =>
      track("bundles", { types: [{ id: "micro", price: 7, transfer: 2048 }] }),
    traffic: (_target, range, _now, offset) =>
      track("traffic", {
        start: trafficRange(range, new Date(now), offset).start.toISOString(),
        totals: { combined: 123 },
        warnings: [],
      }),
    staticIps: () => track("static-ips", []),
  };
  const cache = new ResourceSnapshots(store, gateway, { now: () => now });
  await cache.collect();
  assert.equal(calls.filter((c) => c.startsWith("instances:")).length, 9);
  assert.ok(calls.includes("bundles") && calls.includes("traffic"));
  assert.ok(peak <= 4);
  const before = calls.length;
  await cache.collect();
  assert.equal(calls.length, before);
  assert.ok(store.snapshots().some((s) => s.key.startsWith("/traffic?")));
});

test("traffic snapshots are isolated by timezone and replaced when the calendar period changes", async (t) => {
  const { store, account } = fixture(t);
  let now = Date.parse("2026-10-31T23:00:00Z");
  const cache = new ResourceSnapshots(store, {}, { now: () => now });
  const req = {
    path: "/api/traffic",
    query: {
      accountId: account.id,
      region: "us-east-1",
      id: "one",
      range: "month",
      utcOffsetMinutes: "0",
    },
  };
  let calls = 0;
  const loader = async () => ({
    start: trafficRange("month", new Date(now), 0).start.toISOString(),
    totals: { combined: ++calls },
    warnings: [],
  });
  await cache.read(req, loader);
  assert.notEqual(
    snapshotKey(req.path, req.query),
    snapshotKey(req.path, { ...req.query, utcOffsetMinutes: "480" }),
  );
  now = Date.parse("2026-11-01T00:01:00Z");
  assert.equal((await cache.read(req, loader)).totals.combined, 2);
});

test("mutation invalidation detaches obsolete requests and removed accounts cannot reappear on disk", async (t) => {
  const { store, account } = fixture(t);
  const cache = new ResourceSnapshots(store, {
    scan: async () => ({ items: ["updated"], errors: [] }),
  });
  const key = snapshotKey("/instances", {
    accountId: account.id,
    region: "us-east-1",
  });
  await cache.load(key, async () => ({ items: ["running"], errors: [] }));
  const held = deferred();
  const old = cache.load(
    key,
    async () => {
      await held.promise;
      return { items: ["obsolete"], errors: [] };
    },
    true,
  );
  cache.invalidate((k) => k === "/api" + key);
  await cache.entries.get(key).pending;
  held.resolve();
  await old;
  assert.deepEqual(store.snapshots()[0].value.items, ["updated"]);
  const pending = deferred();
  const late = cache.load(
    key,
    async () => {
      await pending.promise;
      return { items: ["deleted"], errors: [] };
    },
    true,
  );
  store.deleteAccount(account.id);
  cache.accountsChanged();
  pending.resolve();
  await late;
  assert.deepEqual(store.snapshots(), []);
});

test("bundle-only price queries call GetBundles without GetBlueprints or GetRegions", async (t) => {
  const { store, account } = fixture(t);
  const gateway = new AwsGateway(store),
    calls = [];
  gateway.send = async (_account, _service, _region, command) => {
    calls.push(command);
    return {
      bundles: [
        {
          bundleId: "micro",
          isActive: true,
          supportedPlatforms: ["LINUX_UNIX"],
          price: 7,
        },
      ],
    };
  };
  assert.equal(
    (await gateway.bundles(account.id, "lightsail", "us-east-1")).types[0]
      .price,
    7,
  );
  assert.deepEqual(calls, ["GetBundles"]);
});

test("persisted snapshots remain authenticated and explicit refresh waits for actual results", async (t) => {
  const { store, account } = fixture(t);
  const gate = deferred();
  let held = false,
    calls = 0;
  const gateway = {
    scan: async () => {
      calls++;
      if (held) await gate.promise;
      return {
        items: [],
        errors: [],
        scanned: 1,
        at: new Date().toISOString(),
      };
    },
  };
  const app = createApp(store, gateway),
    server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const session = store.createSession(),
    url = `http://127.0.0.1:${server.address().port}/api/instances?accountId=${account.id}&region=us-east-1&service=lightsail`;
  const headers = { Cookie: `panel_session=${session.token}` };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers })).status, 200);
  held = true;
  let completed = false;
  const manual = fetch(url + "&refresh=1", { headers }).then((r) => {
    completed = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(completed, false);
  const cached = await fetch(url, { headers });
  assert.equal(cached.headers.get("X-Panel-Cache"), "hit");
  gate.resolve();
  assert.equal((await manual).status, 200);
  assert.equal(calls, 2);
});
