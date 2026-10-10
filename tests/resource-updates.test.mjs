import assert from "node:assert/strict";
import test from "node:test";
import { ResourceCache } from "../src/lib/resource-cache.ts";
import { ReadCache } from "../server/read-cache.mjs";
import { matchesUpdate, mutationUpdate } from "../shared/resource-update.ts";

test("mutations invalidate only affected resources and scopes, preserving metrics and unrelated regions", async () => {
  const update = mutationUpdate("/instances/action", {
    accountId: "one",
    region: "us-east-1",
    action: "rotate-ip",
  });
  const keys = [
    "/instances?accountId=one&region=us-east-1",
    "/instances?accountId=one&region=us-west-2",
    "/instances?accountId=two&region=us-east-1",
    "/static-ips?accountId=one&region=us-east-1",
    "/traffic?accountId=one&region=us-east-1&id=test",
    "/catalog?accountId=one&region=us-east-1",
    "/instances?accountId=all&region=all",
  ];
  for (const cache of [new ResourceCache(), new ReadCache()]) {
    for (const key of keys) await cache.load(key, async () => ({ value: key }));
    cache.invalidate((key) => matchesUpdate(key, update));
    const called = [];
    for (const key of keys)
      await cache.load(key, async () => {
        called.push(key);
        return {};
      });
    assert.deepEqual(called, [keys[0], keys[3], keys[6]]);
  }
  assert.ok(
    matchesUpdate("/api/instances?accountId=one&region=us-east-1", update),
  );
  assert.deepEqual(
    mutationUpdate("/ports", { accountId: "one", region: "us-east-1" })
      .resources,
    ["ports"],
  );
  assert.equal(mutationUpdate("/accounts", { name: "test" }), undefined);
});

test("invalidating a snapshot detaches old requests without clearing the displayed value", async () => {
  const cache = new ResourceCache();
  const path = "/instances?accountId=one&region=us-east-1";
  await cache.load(path, async () => ({ state: "running" }));
  let resolve;
  const old = cache.load(
    path,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    true,
  );
  cache.invalidate((key) => key === path);
  assert.equal(cache.peek(path), undefined);
  assert.deepEqual(cache.peek(path, true), { state: "running" });
  await cache.load(path, async () => ({ state: "stopped" }));
  resolve({ state: "obsolete" });
  await old;
  assert.deepEqual(cache.peek(path), { state: "stopped" });
  await assert.rejects(
    cache.load(
      path,
      async () => {
        throw Error("offline");
      },
      true,
    ),
  );
  assert.deepEqual(cache.peek(path, true), { state: "stopped" });
  assert.equal(cache.peek(path), undefined);
});
