import assert from "node:assert/strict";
import test from "node:test";
import { ReadCache } from "../server/read-cache.mjs";
import { ResourceCache } from "../src/lib/resource-cache.ts";
import { scheduleAutoRefresh } from "../src/lib/auto-refresh.ts";
import { AUTO_REFRESH_MS, refreshPath } from "../shared/refresh-policy.ts";

test("server AWS snapshots survive reloads, share pending reads, and refresh only when due or requested", async () => {
  let now = 1000,
    calls = 0;
  const cache = new ReadCache(AUTO_REFRESH_MS, () => now);
  const read = () => Promise.resolve({ items: [++calls] });
  const req = {
    path: "/api/instances",
    query: { accountId: "sg", region: "ap-southeast-1" },
  };
  const first = await cache.read(req, read);
  assert.equal(first.cacheExpiresAt, now + AUTO_REFRESH_MS);
  now += 299_999;
  assert.deepEqual(
    await cache.read(
      { ...req, query: { region: "ap-southeast-1", accountId: "sg" } },
      read,
    ),
    first,
  );
  assert.equal(calls, 1);
  now++;
  const [a, b] = await Promise.all([
    cache.read(req, read),
    cache.read(req, read),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls, 2);
  await cache.read({ ...req, query: { ...req.query, refresh: "1" } }, read);
  assert.equal(calls, 3);
  await cache.read(req, read);
  assert.equal(calls, 3);
  cache.clear();
  await cache.read(req, read);
  assert.equal(calls, 4);
  await cache.read(
    { ...req, query: { ...req.query, accountId: "other" } },
    read,
  );
  assert.equal(calls, 5);
});

test("regional failures are also cached, with manual retries bypassing their deadline", async () => {
  const cache = new ReadCache();
  let calls = 0;
  const loader = () => {
    calls++;
    throw Error("UnrecognizedClientException");
  };
  await assert.rejects(cache.load("region", loader));
  await assert.rejects(cache.load("region", loader));
  assert.equal(calls, 1);
  await assert.rejects(cache.load("region", loader, true));
  assert.equal(calls, 2);
});

test("browser reloads restore the same session without extending the server deadline or persisting keys", async () => {
  let now = 1000,
    calls = 0;
  const values = new Map();
  const storage = {
    getItem: (k) => values.get(k),
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  const key = "/instances?accountId=sg&region=ap-southeast-1";
  const first = new ResourceCache(AUTO_REFRESH_MS, () => now);
  first.restore(storage, "session-a");
  await first.load(key, async () => ({ items: [1], cacheExpiresAt: 301_000 }));
  await first.load("/key-pair?accountId=sg", async () => ({
    privateKey: "NEVER_SAVE",
  }));
  assert.ok(!storage.getItem("session-a").includes("NEVER_SAVE"));
  now += 120_000;
  const reloaded = new ResourceCache(AUTO_REFRESH_MS, () => now);
  reloaded.restore(storage, "session-a");
  assert.equal(
    reloaded.nextExpiry((path) => path === key),
    301_000,
  );
  await reloaded.load(key, async () => {
    calls++;
    return {};
  });
  assert.equal(calls, 0);
  now = 301_000;
  await reloaded.load(key, async () => {
    calls++;
    return {};
  });
  assert.equal(calls, 1);
  reloaded.restore(storage, "session-b");
  assert.equal(reloaded.peek(key, true), undefined);
  assert.equal(storage.getItem("session-a"), undefined);
  await reloaded.load(key, async () => ({ items: [2] }));
  reloaded.clear();
  const signedOut = new ResourceCache();
  signedOut.restore(storage, "session-b");
  assert.equal(signedOut.peek(key, true), undefined);
});

test("only an explicit resource refresh bypasses server snapshots", () => {
  const path = "/traffic?accountId=sg&range=month";
  assert.equal(refreshPath(path, false), path);
  assert.equal(refreshPath(path, true), path + "&refresh=1");
  assert.equal(refreshPath("/accounts", true), "/accounts");
  assert.equal(refreshPath("/auth", true), "/auth");
});

test("automatic refresh waits five minutes, pauses while hidden, runs once on return, and cancels on unmount", () => {
  let now = 0,
    visible = true,
    calls = 0,
    sequence = 0;
  const timers = new Map(),
    listeners = new Set();
  const environment = {
    now: () => now,
    visible: () => visible,
    setTimer: (callback, delay) => {
      const id = ++sequence;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onVisibility: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const advance = (time) => {
    now = time;
    for (const [id, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(id);
        timer.callback();
      }
  };
  const setVisible = (value) => {
    visible = value;
    for (const listener of listeners) listener();
  };
  const stop = scheduleAutoRefresh(AUTO_REFRESH_MS, () => calls++, environment);
  advance(AUTO_REFRESH_MS - 1);
  assert.equal(calls, 0);
  setVisible(false);
  advance(AUTO_REFRESH_MS + 60_000);
  assert.equal(calls, 0);
  setVisible(true);
  advance(now + 1000);
  assert.equal(calls, 1);
  setVisible(false);
  setVisible(true);
  advance(now + AUTO_REFRESH_MS);
  assert.equal(calls, 1);
  stop();
  assert.equal(listeners.size, 0);
  const cancel = scheduleAutoRefresh(
    now + AUTO_REFRESH_MS,
    () => calls++,
    environment,
  );
  cancel();
  advance(now + AUTO_REFRESH_MS);
  assert.equal(calls, 1);
  assert.equal(timers.size, 0);
});

test("failed resource reads schedule a later automatic retry instead of stopping refresh forever", async () => {
  const cache = new ResourceCache(AUTO_REFRESH_MS, () => 1000);
  await assert.rejects(
    cache.load("/traffic?accountId=sg", async () => {
      throw Error("network");
    }),
  );
  assert.equal(
    cache.nextExpiry((key) => key.startsWith("/traffic")),
    301_000,
  );
  cache.clear();
  assert.equal(
    cache.nextExpiry(() => true),
    undefined,
  );
});
