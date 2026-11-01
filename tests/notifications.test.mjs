import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Store } from "../server/store.mjs";
import { Notifications, notificationInput } from "../server/notifications.mjs";
import {
  ResourceSnapshots,
  snapshotKey,
} from "../server/resource-snapshots.mjs";
import { createApp } from "../server/app.mjs";
import { TrafficGuard } from "../server/traffic-guard.mjs";
import {
  defaultNotifications,
  formatNotification,
  notificationIcon,
  notificationChoices,
  notificationExamples,
} from "../shared/notifications.ts";

const root =
  process.platform === "win32"
    ? "C:/Users/haochi/Documents/Codex/Temp/lightsail-settings-tests"
    : join(tmpdir(), "lightsail-settings-tests");
const token = "123456789:" + "a".repeat(35);
const input = (patch = {}) => {
  const { telegramConfigured, ...defaults } =
    structuredClone(defaultNotifications);
  return {
    ...defaults,
    telegramToken: token,
    telegramEnabled: true,
    telegramChatId: "-1001234567890",
    events: notificationChoices
      .map((v) => v.value)
      .filter((v) => v !== "daily"),
    ...patch,
  };
};
function fixture(t, options = {}) {
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "notify-"));
  let store = new Store(dir),
    service = new Notifications(store, options),
    closed = false;
  t.after(() => {
    if (!closed) store.close();
    assert.ok(
      resolve(dir).startsWith(
        resolve(root) + (process.platform === "win32" ? "\\" : "/"),
      ),
    );
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    get store() {
      return store;
    },
    get service() {
      return service;
    },
    reopen() {
      store.close();
      store = new Store(dir);
      service = new Notifications(store, options);
    },
    close() {
      store.close();
      closed = true;
    },
  };
}

test("Telegram settings encrypt tokens, keep blank tokens, reject incomplete enabled configs, and explicitly clear secrets", (t) => {
  const f = fixture(t);
  assert.equal(f.service.settings().telegramEnabled, false);
  assert.deepEqual(f.service.settings().events, [
    "operation-failed",
    "traffic-stop",
    "ip",
    "daily",
  ]);
  const result = f.service.update(input());
  assert.equal(result.telegramToken, "");
  assert.equal(result.telegramConfigured, true);
  assert.equal(f.service.settings(true).telegramToken, token);
  assert.ok(
    !JSON.stringify(f.store.config("telegram-settings")).includes(token),
  );
  assert.ok(!JSON.stringify(f.store.logs()).includes(token));
  f.service.update(input({ telegramToken: "" }));
  assert.equal(f.service.settings(true).telegramToken, token);
  f.service.update(
    input({ telegramEnabled: false, telegramToken: "", clearToken: true }),
  );
  assert.equal(f.service.settings().telegramConfigured, false);
  assert.throws(() => f.service.update(input({ telegramToken: "" })), /Token/);
  for (const patch of [
    { apiBase: "http://example.com" },
    { apiBase: "https://user:pass@example.com" },
    { apiBase: "https://example.com/?key=secret" },
    { timezone: "invalid/zone" },
    { reportTime: "25:00" },
    { events: ["keepalive"] },
    { telegramToken: "invalid" },
    { telegramChatId: "wrong chat" },
  ])
    assert.throws(() => notificationInput.parse(input(patch)));
});

test("only confirmed resource outcomes notify once; submitted operations and SSH key data never notify", (t) => {
  const f = fixture(t);
  f.service.update(input());
  const id = f.store.audit({
    action: "open-port",
    target: "web",
    status: "submitted",
  });
  assert.equal(f.service.records().length, 0);
  f.store.updateAudit(id, { status: "success", detail: "TCP 443 已开放" });
  f.store.updateAudit(id, { status: "success", detail: "重复状态" });
  assert.equal(f.service.records().length, 1);
  assert.match(f.service.records()[0].message, /TCP 443/);
  for (const action of [
    "ssh-connect",
    "download-default-key",
    "verify-account",
    "notification-sent",
  ])
    f.store.audit({ action, detail: "PRIVATE_KEY_MUST_NOT_BE_SENT" });
  assert.equal(f.service.records().length, 1);
  const stop = f.store.audit({
    action: "traffic-auto-stop",
    target: "web",
    status: "submitted",
  });
  f.store.updateAudit(stop, { status: "failed", detail: "停止请求被拒绝" });
  assert.equal(f.service.records()[0].type, "traffic-stop");
  assert.match(f.service.records()[0].title, /失败/);
});

test("pending delivery survives service restart and sends no credentials in its message or public records", async (t) => {
  const sent = [];
  const f = fixture(t, {
    send: async (n, text) => {
      assert.equal(n.telegramToken, token);
      sent.push(text);
    },
  });
  f.service.update(input());
  f.service.enqueue(
    "operation-success",
    "persistent",
    "实例启动成功",
    "目标：web",
  );
  assert.equal(
    f.service.enqueue("operation-success", "persistent", "重复", "重复"),
    false,
  );
  assert.ok(!JSON.stringify(f.service.records()).includes(token));
  f.reopen();
  await f.service.tick();
  assert.equal(sent.length, 1);
  assert.ok(!sent[0].includes(token));
  assert.match(sent[0], /^<b>🟢 实例启动成功<\/b>/);
  assert.match(sent[0], /<blockquote><b>web<\/b><\/blockquote>/);
  assert.match(sent[0], /🕒 \d{4}\.\d{2}\.\d{2} - \d{2}:\d{2}:\d{2}/);
  assert.equal(f.service.records()[0].status, "sent");
  await f.service.tick();
  assert.equal(sent.length, 1);
});

test("notification formatting escapes resource text, shares preview styles, and keeps failure status and timezone accurate", () => {
  const source = {
    ...notificationExamples["traffic-stop"],
    type: "traffic-stop",
    at: "2026-11-01T01:02:03Z",
    title: "流量保护关机失败",
    message:
      "实例：<web>&</blockquote>\n账户：<QA>\n区域：ap-southeast-1\n本月入站＋出站达到 95.12%，阈值 95%\nAWS 拒绝停止请求",
  };
  const html = formatNotification(source, true, "Asia/Shanghai");
  assert.match(html, /^<b>🔴 流量保护关机失败<\/b>/);
  assert.match(html, /<b>🇸🇬 &lt;web&gt;&amp;&lt;\/blockquote&gt;<\/b>/);
  assert.match(html, /<b>&lt;QA&gt;<\/b>/);
  assert.match(html, /本月流量 <b>95\.1%<\/b>/);
  assert.match(html, /已用 1902\.4 \/ 2000\.0 GB · 剩余 97\.6 GB/);
  assert.match(html, /阈值 95%； AWS 拒绝停止请求/);
  assert.match(html, /🕒 2026\.11\.01 - 09:02:03$/);
  assert.match(
    formatNotification(source, false, "UTC"),
    /🕒 2026\.11\.01 - 01:02:03$/,
  );
  assert.equal(
    notificationIcon({ type: "operation-failed", title: "启动实例" }),
    "🔴",
  );
  assert.equal(notificationIcon({ type: "ip", title: "公网 IP 变化" }), "🟠");
  assert.doesNotMatch(
    formatNotification({ ...source, usage: { used: -1, total: 0 } }),
    /剩余/,
  );
  assert.ok(
    Array.from(
      formatNotification({
        type: "daily",
        title: "日报",
        message: "😀".repeat(6000),
      }),
    ).length < 4096,
  );
});

test("traffic protection request failures notify with the default event selection without changing stop behavior", async (t) => {
  const f = fixture(t);
  const account = f.store.saveAccount(
    { name: "QA", region: "ap-southeast-1" },
    {},
  );
  let stops = 0;
  const guard = new TrafficGuard(
    f.store,
    {
      send: async (_account, _service, _region, command) =>
        command === "GetInstance"
          ? {
              instance: {
                arn: "same-instance",
                bundleId: "micro",
                state: { name: "running" },
              },
            }
          : { bundles: [{ bundleId: "micro", transferPerMonthInGb: 100 }] },
      traffic: async () => ({
        totals: { combined: 96 * 1024 ** 3 },
        warnings: [],
      }),
      perform: async () => {
        stops++;
        throw Object.assign(Error("IAM 拒绝停止请求"), {
          name: "AccessDeniedException",
        });
      },
    },
    () => {},
  );
  f.service.update(input({ events: defaultNotifications.events }));
  await guard.configure({
    accountId: account.id,
    region: "ap-southeast-1",
    id: "web",
    service: "lightsail",
    enabled: true,
    thresholdPercent: 95,
    utcOffsetMinutes: 480,
  });
  await guard.check(f.store.trafficLimits()[0]);
  assert.equal(stops, 1);
  const record = f.service.records().find((r) => r.type === "traffic-stop");
  assert.match(record.title, /流量保护关机失败/);
  assert.match(record.message, /IAM 拒绝停止请求/);
  assert.match(formatNotification(record, true), /<b>96\.0%<\/b>/);
  assert.equal(f.store.trafficLimits()[0].status, "paused");
});

test("status and IP observations establish a silent durable baseline and ignore incomplete or aggregate reads", (t) => {
  let now = 100000;
  const f = fixture(t, { now: () => now });
  f.service.update(input());
  const account = f.store.saveAccount({ name: "QA", region: "us-east-1" }, {});
  const key = snapshotKey("/instances", {
    accountId: account.id,
    region: "us-east-1",
  });
  const item = {
    accountId: account.id,
    id: "web",
    name: "web",
    region: "us-east-1",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    state: "running",
    publicIp: "198.51.100.1",
  };
  const observe = (i, extra = {}) => {
    now++;
    f.store.emit("snapshot:" + encodeURIComponent(key), {
      value: { items: [i], errors: [], ...extra },
    });
  };
  observe(item);
  assert.equal(f.service.records().length, 0);
  f.reopen();
  observe({
    ...item,
    createdAt: item.createdAt.toISOString(),
    state: "stopped",
  });
  assert.equal(f.service.records()[0].type, "status");
  observe({ ...item, state: "stopped" });
  assert.equal(f.service.records().length, 1);
  observe({ ...item, createdAt: "replacement", state: "running" });
  assert.equal(f.service.records().length, 1);
  observe({ ...item, createdAt: "replacement", publicIp: "198.51.100.2" });
  assert.equal(f.service.records()[0].type, "ip");
  assert.doesNotMatch(f.service.records()[0].message, /IPv6/);
  observe(item, { errors: [{ message: "incomplete" }] });
  assert.equal(f.service.records().length, 2);
  f.service.snapshot(key.replace(account.id, "all"), {
    value: { items: [item] },
  });
  assert.equal(f.service.records().length, 2);
});

test("real snapshot read failures notify once and recovery uses existing AWS reads without adding queries", async (t) => {
  const f = fixture(t);
  f.service.update(input());
  const account = f.store.saveAccount({ name: "QA", region: "us-east-1" }, {});
  const cache = new ResourceSnapshots(f.store, {});
  const key = snapshotKey("/instances", {
    accountId: account.id,
    region: "us-east-1",
  });
  let calls = 0;
  const fail = async () => {
    calls++;
    throw Error("AWS timeout");
  };
  await assert.rejects(cache.load(key, fail, true));
  await assert.rejects(cache.load(key, fail, true));
  assert.equal(f.service.records().length, 1);
  assert.equal(calls, 2);
  await cache.load(
    key,
    async () => {
      calls++;
      return { items: [], errors: [] };
    },
    true,
  );
  assert.equal(calls, 3);
  assert.deepEqual(
    f.service.records().map((r) => r.type),
    ["monitor-recovery", "monitor-error"],
  );
});

test("Telegram rate limits persist global backoff and redact tokens; permanent errors stop retrying", async (t) => {
  let now = 100000,
    count = 0;
  const f = fixture(t, {
    now: () => now,
    send: async () => {
      count++;
      if (count === 1)
        throw Object.assign(Error("rate limited " + token), { retryAfter: 60 });
      throw Object.assign(Error("Forbidden"), { permanent: true });
    },
  });
  f.service.update(input());
  f.service.enqueue("operation-failed", "rate", "失败", "test");
  await f.service.tick();
  assert.equal(count, 1);
  assert.ok(!JSON.stringify(f.service.records()).includes(token));
  assert.ok(!JSON.stringify(f.store.logs()).includes(token));
  assert.equal(f.service.records()[0].nextAt, 160000);
  f.reopen();
  now = 159999;
  await f.service.tick();
  assert.equal(count, 1);
  now = 160000;
  await f.service.tick();
  assert.equal(count, 2);
  assert.equal(f.service.records()[0].status, "failed");
  now += 3600000;
  await f.service.tick();
  assert.equal(count, 2);
});

test("future retries do not block fresh notifications; changing recipients cancels queued old messages", async (t) => {
  let now = 100000;
  const sent = [];
  const f = fixture(t, {
    now: () => now,
    send: async (_n, text) => {
      if (text.includes("旧消息")) throw Error("temporary");
      sent.push(text);
    },
  });
  f.service.update(input());
  for (let i = 0; i < 3; i++)
    f.service.enqueue("status", "future" + i, "旧消息", "text");
  await f.service.tick();
  now++;
  f.service.enqueue("status", "fresh", "新消息", "text");
  await f.service.tick();
  assert.equal(sent.length, 1);
  f.service.update(
    input({ telegramToken: "", telegramChatId: "-1009999999999" }),
  );
  assert.equal(
    f.service.records().filter((r) => r.status === "skipped").length,
    3,
  );
});

test("daily summaries use saved snapshots and timezone, deduplicate across restart, and label missing traffic", async (t) => {
  let now = Date.parse("2026-11-01T01:00:00Z");
  const sent = [];
  const f = fixture(t, {
    now: () => now,
    send: async (_n, text) => sent.push(text),
  });
  const account = f.store.saveAccount({ name: "QA", region: "us-east-1" }, {});
  f.store.saveSnapshot(
    snapshotKey("/instances", { accountId: account.id, region: "us-east-1" }),
    account.id,
    now,
    now + 300000,
    {
      items: [
        {
          id: "web",
          name: "web",
          accountId: account.id,
          region: "us-east-1",
          state: "running",
        },
      ],
      errors: [],
    },
  );
  f.service.update(
    input({
      events: ["daily"],
      reportTime: "09:00",
      timezone: "Asia/Shanghai",
    }),
  );
  f.store.saveSnapshot(
    snapshotKey("/traffic", {
      accountId: account.id,
      region: "us-east-1",
      id: "web",
      range: "month",
      utcOffsetMinutes: 480,
    }),
    account.id,
    now,
    now + 300000,
    {
      start: "2026-09-30T16:00:00.000Z",
      end: "2026-11-01T00:55:00.000Z",
      totals: { combined: 999 * 1024 ** 3 },
      warnings: [],
    },
  );
  await f.service.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /流量数据尚未就绪/);
  assert.match(sent[0], /运行中：1/);
  assert.doesNotMatch(sent[0], /999\.00 GB/);
  assert.match(sent[0], /🇺🇸 web/);
  assert.doesNotMatch(sent[0], /采集|非 AWS|Asia\/Shanghai/);
  assert.equal((sent[0].match(/🕒/g) || []).length, 1);
  f.reopen();
  now += 60000;
  await f.service.tick();
  assert.equal(sent.length, 1);
  now += 86400000;
  await f.service.tick();
  assert.equal(sent.length, 2);
});

test("settings endpoints require session and CSRF, reject Aliyun-only fields, hide tokens, and queue tests", async (t) => {
  const f = fixture(t);
  const app = createApp(
    f.store,
    {},
    { dist: "not-built", notificationSender: async () => {} },
  );
  const session = f.store.createSession();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = "http://127.0.0.1:" + server.address().port + "/api";
  const headers = {
    Cookie: "panel_session=" + session.token,
    "X-CSRF-Token": session.csrf,
    "Content-Type": "application/json",
  };
  assert.equal((await fetch(url + "/settings")).status, 401);
  assert.equal(
    (
      await fetch(url + "/settings", {
        method: "PUT",
        headers: { ...headers, "X-CSRF-Token": "wrong" },
        body: JSON.stringify({ notifications: input() }),
      })
    ).status,
    403,
  );
  let r = await fetch(url + "/settings", {
    method: "PUT",
    headers,
    body: JSON.stringify({ billingEnabled: true, notifications: input() }),
  });
  assert.equal(r.status, 400);
  r = await fetch(url + "/settings", {
    method: "PUT",
    headers,
    body: JSON.stringify({ notifications: input() }),
  });
  assert.equal(r.status, 200);
  assert.ok(!(await r.text()).includes(token));
  r = await fetch(url + "/settings", { headers });
  const result = await r.json();
  assert.equal(result.notifications.telegramConfigured, true);
  assert.equal(result.notifications.telegramToken, "");
  assert.equal(
    (
      await fetch(url + "/notifications/test", {
        method: "POST",
        headers,
        body: "{}",
      })
    ).status,
    202,
  );
  assert.equal(
    (
      await fetch(url + "/notifications/test", {
        method: "POST",
        headers,
        body: "{}",
      })
    ).status,
    429,
  );
  r = await fetch(url + "/notifications", { headers });
  const records = await r.json();
  assert.equal(records.items.length, 1);
  assert.ok(!JSON.stringify(records).includes(token));
});

test("closing Store aborts in-flight notification delivery and avoids writes after SQLite closes", async (t) => {
  let started;
  const entered = new Promise((r) => {
    started = r;
  });
  const f = fixture(t, {
    send: (_n, _text, signal) =>
      new Promise((_r, reject) => {
        started();
        signal.addEventListener("abort", () => reject(Error("aborted")), {
          once: true,
        });
      }),
  });
  f.service.update(input());
  f.service.enqueue("status", "close", "状态", "text");
  const running = f.service.tick();
  await entered;
  f.close();
  await running;
  assert.equal(f.service.running, false);
});
