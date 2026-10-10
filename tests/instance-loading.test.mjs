import assert from "node:assert/strict";
import test from "node:test";
import {
  cachedInstanceScan,
  loadInstanceScan,
} from "../src/lib/instance-scan.ts";
import { ResourceCache } from "../src/lib/resource-cache.ts";
import { account as accountInput } from "../server/validation.mjs";
import { ApiError } from "../src/lib/api-error.ts";
import { scanNotices } from "../src/lib/scan-notices.ts";

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

test("resource mutations retain every regional row until its own refresh finishes", async () => {
  const cache = new ResourceCache();
  const selected = scope("sg", "all");
  const read = async (path) => {
    const query = new URLSearchParams(path.split("?")[1]);
    return path.startsWith("/regions")
      ? { items: [{ id: "ap-southeast-1" }, { id: "us-east-1" }] }
      : scan("sg", query.get("region"));
  };
  await loadInstanceScan(cache, selected, read, () => {});
  cache.invalidate((path) => path.startsWith("/instances?"));
  const waiting = deferred();
  const ready = deferred();
  const snapshots = [];
  const loading = loadInstanceScan(
    cache,
    selected,
    async (path) => {
      const query = new URLSearchParams(path.split("?")[1]);
      if (query.get("region") === "ap-southeast-1") return waiting.promise;
      return scan("sg", "us-east-1", []);
    },
    (data, pending) => {
      snapshots.push(data?.items.map((item) => `${item.region}:${item.id}`));
      if (pending && data?.scanned === 2 && data.items.length === 1)
        ready.resolve();
    },
  );
  await ready.promise;
  assert.ok(
    snapshots.every((items) => items.includes("ap-southeast-1:server")),
  );
  waiting.resolve(scan("sg", "ap-southeast-1", ["updated-server"]));
  await loading;
  assert.deepEqual(snapshots.at(-1), ["ap-southeast-1:updated-server"]);
});

test("a connection outage keeps successful rows and yields one dismissible panel notice", async () => {
  const cache = new ResourceCache();
  const selected = scope("sg", "all");
  const read = async (path) => {
    const query = new URLSearchParams(path.split("?")[1]);
    return path.startsWith("/regions")
      ? {
          items: [
            { id: "ap-southeast-1" },
            { id: "us-east-1" },
            { id: "ap-northeast-1" },
          ],
        }
      : scan("sg", query.get("region"));
  };
  let latest;
  await loadInstanceScan(cache, selected, read, () => {});
  const rows = cachedInstanceScan(cache, selected).items;
  await loadInstanceScan(
    cache,
    selected,
    async () => {
      throw new ApiError("无法连接面板服务", "connection");
    },
    (data) => {
      latest = data;
    },
    true,
  );
  assert.deepEqual(latest.items, rows);
  assert.equal(latest.errors.length, 2);
  assert.equal(scanNotices(latest.errors).length, 1);
  assert.equal(scanNotices(latest.errors)[0].key, "panel-connection");
  assert.equal(cachedInstanceScan(cache, selected).errors.length, 0);
  await loadInstanceScan(
    cache,
    selected,
    read,
    (data) => {
      latest = data;
    },
    true,
  );
  assert.equal(latest.errors.length, 0);
  assert.equal(latest.items.length, 3);
});

test("scan notices combine cached connection failures while keeping actual AWS errors", () => {
  const errors = ["us-east-1", "ap-northeast-1"].map((region) => ({
    account: "AWS",
    region,
    message:
      "无法连接面板服务，请检查本机服务和浏览器网络。（Failed to fetch）",
  }));
  errors.push({
    account: "AWS",
    region: "ap-southeast-1",
    message: "AccessDeniedException: denied",
  });
  assert.equal(scanNotices(errors).length, 2);
  assert.match(scanNotices(errors)[1].message, /Singapore.*AccessDenied/);
  assert.equal(
    scanNotices([{ ...errors[0], kind: "http" }])[0].key === "panel-connection",
    false,
  );
});
