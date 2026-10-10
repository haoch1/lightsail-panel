import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { TrafficGuard, TRAFFIC_CHECK_MS } from "../server/traffic-guard.mjs";
import { AwsGateway } from "../server/aws.mjs";
import { trafficRange } from "../shared/traffic.mjs";
import { createApp } from "../server/app.mjs";
import { trafficLimit } from "../server/validation.mjs";
import { LaunchNetworkQueue } from "../server/launch-network.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "lightsail-panel-guard-"));
  const store = new Store(dir);
  const account = store.saveAccount(
    { name: "test", region: "us-east-1" },
    { accessKeyId: "test-key", secretAccessKey: "test-secret" },
  );
  const target = {
    accountId: account.id,
    region: "ap-southeast-1",
    service: "lightsail",
    id: "example",
  };
  let now = Date.parse("2026-10-10T12:43:00Z");
  const instance = {
    name: target.id,
    arn: "arn:aws:lightsail:ap-southeast-1:123456789012:Instance/test",
    bundleId: "micro",
    state: { name: "running" },
  };
  let allowance = 100,
    used = 80,
    warnings = [],
    stops = 0,
    calls = 0;
  const gateway = {
    send: async (_account, _service, region, command) => {
      calls++;
      assert.equal(region, target.region);
      if (command === "GetInstance")
        return { instance: structuredClone(instance) };
      if (command === "GetBundles")
        return {
          bundles: [
            { bundleId: instance.bundleId, transferPerMonthInGb: allowance },
          ],
        };
      throw Error(command);
    },
    traffic: async (t, range, date, offset) => {
      assert.equal(t.id, target.id);
      assert.equal(range, "month");
      const window = trafficRange(range, date, offset);
      return {
        totals: { combined: used === null ? null : used * 1024 ** 3 },
        warnings,
        start: window.start.toISOString(),
        end: window.end.toISOString(),
      };
    },
    perform: async (input) => {
      assert.deepEqual(input, { ...target, action: "stop" });
      stops++;
      return { operations: [{ id: "stop-1" }] };
    },
  };
  const guard = new TrafficGuard(
    store,
    gateway,
    () => {},
    () => now,
  );
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    store,
    dir,
    target,
    gateway,
    guard,
    instance,
    configure: (enabled = true, percent = 90) =>
      guard.configure({
        ...target,
        enabled,
        thresholdPercent: percent,
        utcOffsetMinutes: 480,
      }),
    get stops() {
      return stops;
    },
    get calls() {
      return calls;
    },
    set used(v) {
      used = v;
    },
    set allowance(v) {
      allowance = v;
    },
    set warnings(v) {
      warnings = v;
    },
    advance: () => {
      now += TRAFFIC_CHECK_MS;
    },
    get now() {
      return now;
    },
  };
}

test("custom login lifetimes, renewal, expiration and independent browsers", (t) => {
  const f = fixture(t);
  assert.throws(() => f.store.createSession(0), /有效期/);
  const before = Date.now(),
    a = f.store.createSession(72),
    b = f.store.createSession(24);
  assert.ok(Math.abs(a.expires - before - 72 * 3600000) < 1000);
  const renew = f.store.renewSession(a.token, 168);
  assert.equal(f.store.session(a.token).expires, renew.expires);
  assert.equal(f.store.session(b.token).expires, b.expires);
  f.store.db
    .prepare("UPDATE sessions SET expires=? WHERE hash=?")
    .run(Date.now() - 1, f.store.hash(a.token));
  assert.equal(f.store.session(a.token), null);
  assert.equal(f.store.renewSession(a.token, 24), null);
  f.store.deleteSession(b.token);
  assert.equal(f.store.session(b.token), null);
});

test("session API keeps cookie and SQLite expiry aligned and protects renewal", async (t) => {
  const f = fixture(t);
  const server = createApp(f.store, {}).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = "http://127.0.0.1:" + server.address().port;
  const req = (path, body, headers = {}) =>
    fetch(origin + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await req("/session", { hours: 24 })).status, 401);
  const response = await req("/setup", {
    password: "testing-password-long",
    sessionHours: 48,
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0],
    session = await response.json();
  assert.match(
    response.headers.get("set-cookie"),
    /Max-Age=17279[89]|Max-Age=172800/,
  );
  const headers = { Cookie: cookie, "X-CSRF-Token": session.csrf };
  assert.equal(
    (
      await req(
        "/session",
        { hours: 24 },
        { ...headers, "X-CSRF-Token": "wrong" },
      )
    ).status,
    403,
  );
  assert.equal((await req("/session", { hours: 2161 }, headers)).status, 400);
  const renewed = await req("/session", { hours: 168 }, headers);
  assert.equal(renewed.status, 200);
  assert.match(
    renewed.headers.get("set-cookie"),
    /Max-Age=60479[89]|Max-Age=604800/,
  );
  const expiry = (await renewed.json()).expires;
  assert.equal(
    (await (await req("/auth", undefined, headers)).json()).expires,
    expiry,
  );
  assert.equal(
    (
      await req(
        "/traffic-limit",
        {
          ...f.target,
          enabled: false,
          thresholdPercent: 90,
          allowanceBytes: 1,
        },
        headers,
      )
    ).status,
    400,
  );
  assert.equal((await req("/logout", {}, headers)).status, 200);
  assert.equal((await req("/session", { hours: 24 }, headers)).status, 401);
});

test("each instance uses its current regional bundle allowance; checks are five minutes apart", async (t) => {
  const f = fixture(t);
  await f.guard.tick();
  assert.equal(f.calls, 0);
  await f.configure();
  await f.guard.tick();
  assert.equal(f.stops, 0);
  assert.equal(f.guard.get(f.target).usedPercent, 80);
  const calls = f.calls;
  await f.guard.tick();
  assert.equal(f.calls, calls);
  f.allowance = 80;
  f.advance();
  await f.guard.tick();
  assert.equal(f.stops, 1);
  assert.equal(f.guard.get(f.target).usedPercent, 100);
  assert.equal(f.guard.get(f.target).allowanceBytes, 80 * 1024 ** 3);
  assert.ok(f.store.logs().some((x) => x.action === "traffic-auto-stop"));
  f.advance();
  await f.guard.tick();
  assert.equal(f.stops, 1);
});

test("automatic stop updates its original audit row after confirming the stopped state", async (t) => {
  const f = fixture(t);
  const queue = new LaunchNetworkQueue(f.store, f.gateway);
  f.guard.onStop = (target, result, auditId, auditDetail) =>
    queue.watch({ ...target, auditDetail }, result, "instances", auditId);
  await f.configure();
  f.used = 99;
  await f.guard.tick();
  const original = f.store
    .logs()
    .find((entry) => entry.action === "traffic-auto-stop");
  assert.equal(original.status, "submitted");
  assert.match(original.detail, /99\.00%.*90%/);
  const send = f.gateway.send;
  f.gateway.send = async (...args) =>
    args[3] === "GetOperation"
      ? { operation: { status: "Succeeded" } }
      : send(...args);
  f.instance.state.name = "stopped";
  await queue.tick();
  const [final] = f.store
    .logs()
    .filter((entry) => entry.action === "traffic-auto-stop");
  assert.equal(final.id, original.id);
  assert.equal(final.status, "success");
  assert.match(final.detail, /已停止.*99\.00%.*90%/);
  assert.equal(f.store.logs().length, 2); // One configuration and one stop.
});

test("a disabled rule cancels a check already waiting for AWS metrics", async (t) => {
  const f = fixture(t);
  await f.configure();
  f.used = 99;
  let release, entered;
  const ready = new Promise((r) => {
    entered = r;
  });
  f.gateway.traffic = async () => {
    entered();
    return new Promise((r) => {
      release = r;
    });
  };
  const checking = f.guard.tick();
  await ready;
  await f.configure(false);
  release({ totals: { combined: 99 * 1024 ** 3 }, warnings: [] });
  await checking;
  assert.equal(f.stops, 0);
  assert.equal(f.guard.get(f.target).enabled, false);
});

test("missing metrics, partial failure and missing allowance never cause a stop", async (t) => {
  const f = fixture(t);
  await f.configure();
  f.used = null;
  await f.guard.tick();
  assert.equal(f.stops, 0);
  assert.equal(f.guard.get(f.target).status, "error");
  f.used = 99;
  f.warnings = ["NetworkOut failed"];
  f.advance();
  await f.guard.tick();
  assert.equal(f.stops, 0);
  f.warnings = [];
  f.allowance = 0;
  f.advance();
  await f.guard.tick();
  assert.equal(f.stops, 0);
});

test("rules bind to the instance ARN so a replacement with the same name is paused", async (t) => {
  const f = fixture(t);
  await f.configure();
  f.used = 99;
  f.instance.arn += "-replacement";
  await f.guard.tick();
  assert.equal(f.stops, 0);
  assert.equal(f.guard.get(f.target).status, "paused");
  f.advance();
  const before = f.calls;
  await f.guard.tick();
  assert.equal(f.calls, before);
});

test("restart preserves stop intent and never replays an ambiguous stop", async (t) => {
  const f = fixture(t);
  await f.configure();
  f.used = 99;
  f.gateway.perform = async () => {
    throw new Error("connection lost");
  };
  await f.guard.tick();
  assert.equal(f.guard.get(f.target).pendingStop, true);
  f.guard.stop();
  f.advance();
  const restarted = new TrafficGuard(
    f.store,
    {
      ...f.gateway,
      perform: async () => {
        throw Error("must not resubmit");
      },
    },
    () => {},
    () => f.now,
  );
  await restarted.tick();
  assert.equal(restarted.get(f.target).status, "uncertain");
  f.instance.state.name = "stopped";
  f.advance();
  await restarted.tick();
  assert.equal(restarted.get(f.target).pendingStop, false);
  assert.equal(restarted.get(f.target).status, "stopped");
});

test("confirmed stop permits protection after a manual restart; month reset never starts instances", async (t) => {
  const f = fixture(t);
  await f.configure();
  f.used = 99;
  await f.guard.tick();
  assert.equal(f.stops, 1);
  f.instance.state.name = "stopped";
  f.advance();
  await f.guard.tick();
  f.instance.state.name = "running";
  f.advance();
  await f.guard.tick();
  assert.equal(f.stops, 2);
  f.instance.state.name = "stopped";
  f.advance();
  await f.guard.tick();
  f.instance.state.name = "running";
  f.used = 0;
  f.advance();
  await f.guard.tick();
  assert.equal(f.stops, 2);
});

test("IAM denial pauses a rule and disabling does not depend on AWS availability", async (t) => {
  const f = fixture(t);
  await f.configure();
  f.used = 99;
  f.gateway.perform = async () => {
    throw Object.assign(new Error("not authorized"), {
      name: "AccessDeniedException",
    });
  };
  await f.guard.tick();
  assert.equal(f.guard.get(f.target).status, "paused");
  f.gateway.send = async () => {
    throw Error("unavailable");
  };
  await f.configure(false);
  assert.equal(f.guard.get(f.target).enabled, false);
});

test("stop checks are non-overlapping, and account deletion removes its rules", async (t) => {
  const f = fixture(t);
  await f.configure();
  f.used = 99;
  await Promise.all([f.guard.tick(), f.guard.tick(), f.guard.tick()]);
  assert.equal(f.stops, 1);
  f.store.deleteAccount(f.target.accountId);
  assert.equal(f.guard.get(f.target), null);
});

test("rules and expiry survive SQLite close and reopen", async (t) => {
  const f = fixture(t);
  await f.configure();
  const session = f.store.createSession(168);
  const other = new Store(f.dir);
  assert.equal(other.trafficLimits()[0].thresholdPercent, 90);
  assert.equal(other.session(session.token).expires, session.expires);
  other.close();
});

test("hourly history and five-minute tails are disjoint, including half-hour timezones", async () => {
  const gateway = new AwsGateway({ account: () => ({ id: "a" }) }),
    calls = [];
  gateway.send = async (_a, _s, _r, _c, p) => {
    calls.push(p);
    return {
      metricData: Array.from(
        { length: (p.endTime - p.startTime) / (p.period * 1000) },
        (_, n) => ({
          timestamp: new Date(p.startTime.getTime() + n * p.period * 1000),
          sum: p.period,
        }),
      ),
    };
  };
  const target = { accountId: "a", id: "example", region: "us-east-1" };
  const data = await gateway.traffic(
    target,
    "today",
    new Date("2026-10-10T20:43:00Z"),
    330,
  );
  assert.equal(data.start, "2026-10-10T18:30:00.000Z");
  assert.equal(data.end, "2026-10-10T20:40:00.000Z");
  assert.equal(data.totals.combined, 2 * 130 * 60);
  const ins = calls.filter((p) => p.metricName === "NetworkIn");
  assert.deepEqual(
    ins.map((p) => p.period),
    [300, 3600, 300],
  );
  assert.equal(ins[0].endTime.getTime(), ins[1].startTime.getTime());
  assert.equal(ins[1].endTime.getTime(), ins[2].startTime.getTime());
  assert.equal(
    trafficLimit.safeParse({ ...target, enabled: true, thresholdPercent: -1 })
      .success,
    false,
  );
});

test("resource completion checks its rule immediately without waiting for the periodic deadline", async (t) => {
  const f = fixture(t);
  await f.configure();
  await f.guard.tick();
  assert.equal(f.stops, 0);
  f.used = 99;
  f.guard.kick = () => {};
  const job = {
    id: "user-start",
    accountId: f.target.accountId,
    region: f.target.region,
    action: "start",
    resources: ["instances"],
    instances: [{ name: f.target.id, stage: "done" }],
  };
  f.guard.resourceUpdated(job);
  await f.guard.tick();
  assert.equal(f.stops, 1);
  const calls = f.calls;
  f.guard.resourceUpdated(job);
  await f.guard.tick();
  assert.equal(f.calls, calls);
});

test("resource completion during an in-flight check is queued and retains its due deadline", async (t) => {
  const f = fixture(t);
  await f.configure();
  const normalTraffic = f.gateway.traffic;
  let release, entered;
  const waiting = new Promise((r) => {
    entered = r;
  });
  const gate = new Promise((r) => {
    release = r;
  });
  let count = 0;
  f.gateway.traffic = async (...args) => {
    const result = await normalTraffic(...args);
    count++;
    if (count === 1) {
      entered();
      await gate;
    }
    return result;
  };
  const checking = f.guard.tick();
  await waiting;
  f.used = 99;
  const job = {
    id: "during-check",
    accountId: f.target.accountId,
    region: f.target.region,
    action: "start",
    resources: ["instances"],
    instances: [{ name: f.target.id, stage: "done" }],
  };
  f.guard.resourceUpdated(job);
  release();
  await checking;
  for (let n = 0; n < 20 && f.guard.busy; n++) await new Promise(setImmediate);
  assert.equal(count, 2);
  assert.equal(f.stops, 1);
  assert.equal(f.guard.get(f.target).lastResourceJob, job.id);
});
