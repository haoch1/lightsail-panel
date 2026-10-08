import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createApp } from "../server/app.mjs";
import { AwsGateway } from "../server/aws.mjs";
import { Store } from "../server/store.mjs";
import { aggregateTraffic, trafficRange } from "../shared/traffic.mjs";
function fixture(t) {
  const root = resolve("../aws-panel-reference");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "instance-tools-test-"));
  let store = new Store(dir);
  const account = store.saveAccount(
    { name: "test", region: "us-east-1" },
    { authType: "default" },
  );
  t.after(() => {
    store.close();
    assert.ok(dir.startsWith(root + "/") || dir.startsWith(root + "\\"));
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    store,
    account,
    g: new AwsGateway(store),
    reopen: () => {
      store.close();
      store = new Store(dir);
      return store;
    },
  };
}
test("traffic windows start at calendar midnight and finish at the completed hour", () => {
  const now = new Date("2026-10-08T05:43:21Z");
  const month = trafficRange("month", now),
    thirty = trafficRange("30d", now);
  assert.equal(month.start.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(month.end.toISOString(), "2026-10-08T05:00:00.000Z");
  assert.equal(thirty.start.toISOString(), "2026-09-09T00:00:00.000Z");
  assert.equal((thirty.end - thirty.start) / 3600000, 29 * 24 + 5);
  assert.equal(
    trafficRange("month", new Date("2027-01-01T00:42:00Z")).start.toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
});
test("traffic totals sum bytes, deduplicate timestamps, and leave absent directions unknown", () => {
  const window = {
    start: new Date("2026-10-01T00:00:00Z"),
    end: new Date("2026-10-03T00:00:00Z"),
  };
  const inSeries = [
    { timestamp: window.start, sum: 100 },
    { timestamp: window.start, sum: 100 },
    { timestamp: "2026-10-02T01:00:00Z", sum: 0 },
    { timestamp: window.end, sum: 999 },
    { timestamp: "2026-09-30T23:00:00Z", sum: 999 },
    { timestamp: "2026-10-01T01:00:00Z", sum: undefined },
  ];
  const data = aggregateTraffic(
    [inSeries, [{ timestamp: window.start, sum: 300 }]],
    window,
  );
  assert.deepEqual(data.totals, { inbound: 100, outbound: 300, combined: 400 });
  assert.deepEqual(data.samples, { inbound: 2, outbound: 1 });
  assert.deepEqual(data.daily[1], {
    date: "2026-10-02",
    inbound: 0,
    outbound: null,
  });
  assert.deepEqual(aggregateTraffic([[], []], window).totals, {
    inbound: null,
    outbound: null,
    combined: null,
  });
});
test("instance traffic calls native NetworkIn/Out Sum Bytes and preserves partial failures", async (t) => {
  const { g, account } = fixture(t);
  const calls = [];
  const target = {
    accountId: account.id,
    region: "ap-northeast-1",
    id: "tokyo-blog",
    service: "lightsail",
  };
  g.send = async (a, s, r, c, p) => {
    assert.equal(a.id, account.id);
    assert.equal(r, target.region);
    assert.equal(s, "lightsail");
    assert.equal(c, "GetInstanceMetricData");
    calls.push(p);
    if (p.metricName === "NetworkOut") throw Error("outbound unavailable");
    return { metricData: [{ timestamp: p.startTime, sum: 4096 }] };
  };
  const data = await g.traffic(target, "30d", new Date("2026-10-08T05:43:00Z"));
  assert.equal(calls.length, 2);
  for (const p of calls) {
    assert.equal(p.instanceName, "tokyo-blog");
    assert.equal(p.period, 3600);
    assert.equal(p.unit, "Bytes");
    assert.deepEqual(p.statistics, ["Sum"]);
    assert.equal((p.endTime - p.startTime) / 3600000, 29 * 24 + 5);
  }
  assert.deepEqual(data.totals, {
    inbound: 4096,
    outbound: null,
    combined: null,
  });
  assert.match(data.warnings[0], /出站查询失败/);
  await g.traffic(target, "month", new Date("2026-11-01T00:40:00Z"));
  assert.equal(calls.length, 2);
});
test("traffic routes validate ranges and removed connection, monitoring and custom key routes return 404", async (t) => {
  const { store, account } = fixture(t),
    calls = [];
  const gateway = {
    traffic: async (t, range, _now, offset) => ({ id: t.id, range, offset }),
  };
  const server = createApp(store, gateway).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = `http://127.0.0.1:${server.address().port}`,
    session = store.createSession();
  const request = (path, body, csrf = true, auth = true) =>
    fetch(origin + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(auth ? { Cookie: `panel_session=${session.token}` } : {}),
        ...(csrf ? { "X-CSRF-Token": session.csrf } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        Origin: origin,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const query = `?accountId=${account.id}&region=us-east-1&id=my-instance&range=`;
  assert.equal((await request("/traffic" + query + "30d")).status, 200);
  assert.equal((await request("/traffic" + query + "year")).status, 400);
  const today = await request(
    "/traffic" + query + "today&utcOffsetMinutes=480",
  );
  assert.equal(today.status, 200);
  assert.equal((await today.json()).offset, 480);
  assert.equal(
    (await request("/traffic" + query + "today&utcOffsetMinutes=1500")).status,
    400,
  );
  for (const path of [
    "/metrics",
    "/ssh/capabilities",
    "/ssh/sessions",
    "/ssh/keys",
  ])
    assert.equal((await request(path)).status, 404);
  assert.equal((await request("/ssh/sessions", { id: "unused" })).status, 404);
  assert.equal((await request("/ssh/keys", { action: "create" })).status, 404);
});
test("upgrades deactivate all historical scheduled tasks and retain their records", (t) => {
  const f = fixture(t);
  for (const service of ["lightsail", "ec2"])
    f.store.db.prepare("INSERT INTO tasks VALUES(?,?)").run(
      service,
      JSON.stringify({
        id: service,
        enabled: true,
        service,
        resourceId: "retained",
      }),
    );
  const upgraded = f.reopen();
  const records = upgraded.db
    .prepare("SELECT body FROM tasks")
    .all()
    .map((r) => JSON.parse(r.body));
  assert.equal(records.length, 2);
  assert.ok(
    records.every((r) => r.enabled === false && r.resourceId === "retained"),
  );
  assert.equal(typeof upgraded.saveTask, "undefined");
});
