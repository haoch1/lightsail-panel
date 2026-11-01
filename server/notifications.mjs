import { createHash, randomUUID } from "node:crypto";
import { Agent, request } from "node:https";
import { z } from "zod";
import { auditActionLabel } from "../shared/audit-actions.ts";
import { trafficRange } from "../shared/traffic.mjs";
import {
  defaultNotifications,
  formatNotification,
  notificationChoices,
  notificationRegionFlag,
} from "../shared/notifications.ts";

const types = notificationChoices.map((item) => item.value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const clip = (value, length = 1000) =>
  Array.from(String(value || ""))
    .slice(0, length)
    .join("");
const states = {
  running: "运行中",
  stopped: "已停止",
  pending: "启动中",
  stopping: "停止中",
  shutting_down: "删除中",
  terminated: "已删除",
};
const resourceActions = new Set([
  "start",
  "stop",
  "reboot",
  "terminate",
  "launch",
  "launch-network",
  "enable-ipv6",
  "disable-ipv6",
  "rotate-ip",
  "static-ip-allocate",
  "static-ip-attach",
  "static-ip-detach",
  "static-ip-release",
  "open-port",
  "close-port",
]);
export const notificationInput = z
  .object({
    telegramEnabled: z.boolean(),
    telegramToken: z
      .string()
      .trim()
      .max(256)
      .refine(
        (v) => !v || /^\d+:[A-Za-z0-9_-]{20,200}$/.test(v),
        "Bot Token 格式不正确",
      ),
    clearToken: z.boolean().optional(),
    telegramChatId: z
      .string()
      .trim()
      .max(100)
      .refine(
        (v) => !v || /^-?\d+$/.test(v) || /^@[A-Za-z0-9_]{5,32}$/.test(v),
        "Chat ID 须为数字或 @频道用户名",
      ),
    apiBase: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((v) => {
        const u = new URL(v);
        return (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      }, "Telegram API 地址须为不含凭证、查询参数或片段的 HTTPS 地址"),
    events: z
      .array(z.enum(types))
      .max(types.length)
      .transform((v) => [...new Set(v)]),
    reportTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "日报时间格式应为 HH:mm"),
    timezone: z
      .string()
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "日报时区无效"),
  })
  .strict();

function safeError(error, token) {
  return clip(
    String(error?.message || "Telegram 发送失败")
      .replaceAll(token || "\0", "[REDACTED]")
      .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]"),
    300,
  );
}

/** Server-side HTTPS only; credentials never enter a browser or a queue record. */
export function sendTelegram(settings, message, signal) {
  const url = new URL(
    settings.apiBase.replace(/\/+$/, "") +
      "/bot" +
      settings.telegramToken +
      "/sendMessage",
  );
  const payload = JSON.stringify({
    chat_id: settings.telegramChatId,
    text: message,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  const agent = new Agent({ proxyEnv: process.env });
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        agent,
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 65536)
            req.destroy(Error("Telegram 响应超过大小限制"));
        });
        res.on("error", reject);
        res.on("end", () => {
          let data;
          try {
            data = JSON.parse(body);
          } catch {}
          if (res.statusCode === 200 && data?.ok) return resolve();
          const e = Error(
            `Telegram HTTP ${res.statusCode}：${clip(data?.description || "发送失败", 180)}`,
          );
          e.permanent =
            res.statusCode >= 400 &&
            res.statusCode < 500 &&
            res.statusCode !== 429 &&
            res.statusCode !== 408;
          const seconds = Number(data?.parameters?.retry_after);
          if (Number.isSafeInteger(seconds) && seconds > 0)
            e.retryAfter = Math.min(seconds, 86400);
          reject(e);
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  }).finally(() => agent.destroy());
}

export class Notifications {
  constructor(store, { send = sendTelegram, now = Date.now } = {}) {
    Object.assign(this, { store, send, now, closed: false, running: false });
    this.abort = new AbortController();
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS notification_outbox(id TEXT PRIMARY KEY,at INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notification_state(key TEXT PRIMARY KEY,at INTEGER NOT NULL,body TEXT NOT NULL);`);
    this.listener = (type, data) => {
      if (this.closed) return;
      // Notification failures must not change the outcome of AWS operations.
      try {
        if (type === "audit" && data) this.audit(data);
        if (type.startsWith("snapshot:") && data)
          this.snapshot(decodeURIComponent(type.slice(9)), data);
      } catch {
        console.error("Telegram：无法记录通知事件");
      }
    };
    this.stop = () => {
      this.closed = true;
      clearInterval(this.timer);
      this.abort.abort();
      store.onEvent.delete(this.listener);
      store.onClose.delete(this.stop);
    };
    store.onEvent.add(this.listener);
    store.onClose.add(this.stop);
  }
  settings(secret = false) {
    const stored = this.store.config("telegram-settings") || {};
    const { encryptedToken, ...plain } = stored;
    return {
      ...structuredClone(defaultNotifications),
      ...plain,
      telegramToken:
        secret && encryptedToken ? this.store.decrypt(encryptedToken) : "",
      telegramConfigured: !!encryptedToken,
    };
  }
  update(input) {
    const next = notificationInput.parse(input);
    const old = this.store.config("telegram-settings") || {};
    const { telegramToken, clearToken, ...plain } = next;
    if (clearToken && telegramToken)
      throw Object.assign(Error("清除 Token 与设置新 Token 不能同时提交"), {
        status: 400,
      });
    const encryptedToken = clearToken
      ? undefined
      : telegramToken
        ? this.store.encrypt(telegramToken)
        : old.encryptedToken;
    if (next.telegramEnabled && (!encryptedToken || !next.telegramChatId))
      throw Object.assign(
        Error("启用 Telegram 前须填写 Bot Token 和 Chat ID"),
        { status: 400 },
      );
    this.store.config("telegram-settings", { ...plain, encryptedToken });
    const current = this.settings(true);
    for (const row of this.store.db
      .prepare(
        "SELECT body FROM notification_outbox WHERE json_extract(body,'$.status')='queued'",
      )
      .all()) {
      const item = JSON.parse(row.body);
      if (
        !this.ready(current) ||
        this.destination(current) !== item.destination ||
        (item.type !== "test" && !current.events.includes(item.type))
      )
        this.put({
          ...item,
          status: "skipped",
          error: "通知已关闭、类型已取消或接收配置已更改",
        });
    }
    this.store.audit({
      action: "notification-settings",
      detail: `Telegram ${next.telegramEnabled ? "已启用" : "已关闭"}；已选 ${next.events.length} 类通知`,
    });
    this.store.emit("notifications");
    this.kick();
    return this.settings();
  }
  destination(n) {
    return hash([n.apiBase, n.telegramChatId, n.telegramToken].join("\n"));
  }
  ready(n) {
    return n.telegramEnabled && !!n.telegramToken && !!n.telegramChatId;
  }
  state(key, value) {
    if (value !== undefined) {
      this.store.db
        .prepare("INSERT OR REPLACE INTO notification_state VALUES(?,?,?)")
        .run(key, this.now(), JSON.stringify(value));
      this.store.db.exec(
        "DELETE FROM notification_state WHERE key IN (SELECT key FROM notification_state ORDER BY at DESC LIMIT -1 OFFSET 5000)",
      );
      return value;
    }
    const row = this.store.db
      .prepare("SELECT body FROM notification_state WHERE key=?")
      .get(key);
    return row ? JSON.parse(row.body) : undefined;
  }
  put(item) {
    this.store.db
      .prepare("INSERT OR REPLACE INTO notification_outbox VALUES(?,?,?)")
      .run(item.id, Date.parse(item.at), JSON.stringify(item));
    this.store.emit("notifications");
  }
  records(limit = 20) {
    return this.store.db
      .prepare(
        "SELECT body FROM notification_outbox ORDER BY at DESC,rowid DESC LIMIT ?",
      )
      .all(limit)
      .map((r) => {
        const { destination, ...item } = JSON.parse(r.body);
        return item;
      });
  }
  enqueue(type, key, title, message, { test = false, usage } = {}) {
    const n = this.settings(true);
    if (!this.ready(n) || (!test && !n.events.includes(type))) return false;
    const destination = this.destination(n);
    const id = hash(key + ":" + destination);
    if (
      this.store.db
        .prepare("SELECT 1 FROM notification_outbox WHERE id=?")
        .get(id)
    )
      return false;
    this.store.db.exec(
      "DELETE FROM notification_outbox WHERE id IN (SELECT id FROM notification_outbox WHERE json_extract(body,'$.status')<>'queued' ORDER BY at DESC LIMIT -1 OFFSET 200)",
    );
    if (
      this.store.db
        .prepare(
          "SELECT count(*) AS n FROM notification_outbox WHERE json_extract(body,'$.status')='queued'",
        )
        .get().n >= 500
    )
      return false;
    this.put({
      id,
      at: new Date(this.now()).toISOString(),
      type,
      title: clip(title, 100),
      message: clip(message, 3000),
      ...(usage && { usage }),
      destination,
      status: "queued",
      attempts: 0,
      nextAt: this.now(),
    });
    this.kick();
    return true;
  }
  audit(row) {
    if (!["success", "failed"].includes(row.status)) return;
    const autoStop = row.action === "traffic-auto-stop";
    const monitor = row.action === "traffic-auto-stop-check";
    if (!autoStop && !monitor && !resourceActions.has(row.action)) return;
    const account =
      this.store.accounts().find((a) => a.id === row.account)?.name ||
      row.account ||
      "—";
    const tracked = this.store.db
      .prepare(
        "SELECT body FROM launch_network WHERE json_extract(body,'$.auditId')=? LIMIT 1",
      )
      .get(row.id);
    let region = tracked && JSON.parse(tracked.body).region;
    const rules = autoStop
      ? this.store
          .trafficLimits()
          .filter(
            (rule) =>
              rule.accountId === row.account &&
              rule.id === row.target &&
              (!region || rule.region === region),
          )
      : [];
    const rule = rules.length === 1 ? rules[0] : undefined;
    region ||= rule?.region;
    this.enqueue(
      monitor
        ? "monitor-error"
        : autoStop
          ? "traffic-stop"
          : row.status === "failed"
            ? "operation-failed"
            : "operation-success",
      "audit:" + row.id,
      (autoStop ? "流量保护关机" : auditActionLabel(row.action)) +
        (row.status === "failed" ? "失败" : "成功"),
      `目标：${row.target || "—"}\n账户：${account}\n${region ? `区域：${region}\n` : ""}${autoStop && row.status === "success" && rule ? `阈值 ${rule.thresholdPercent}%` : row.detail || ""}`,
      { usage: rule && { used: rule.usedBytes, total: rule.allowanceBytes } },
    );
  }
  snapshot(key, { value, error }) {
    const [path, search] = key.split("?");
    const q = new URLSearchParams(search);
    if (
      !["/instances", "/traffic"].includes(path) ||
      q.get("accountId") === "all" ||
      q.get("region") === "all"
    )
      return;
    const stateKey = "snapshot:" + key;
    const old = this.state(stateKey);
    const account = this.store
      .accounts()
      .find((a) => a.id === q.get("accountId"))?.name;
    if (!account) return;
    const context = `账户：${account}\n区域：${q.get("region")}\n${q.get("id") ? `实例：${q.get("id")}\n` : ""}`;
    const label = path === "/instances" ? "实例监控" : "流量监控";
    if (error) {
      if (!old?.error)
        this.enqueue(
          "monitor-error",
          `${stateKey}:error:${this.now()}`,
          label + "异常",
          context + error,
        );
      this.state(stateKey, { ...old, error: true });
      return;
    }
    if (!value || value.errors?.length || value.warnings?.length) return;
    if (old?.error)
      this.enqueue(
        "monitor-recovery",
        `${stateKey}:recovery:${this.now()}`,
        label + "恢复",
        context,
      );
    const items = Object.create(null);
    if (path === "/instances")
      for (const item of value.items || []) {
        const created = new Date(item.createdAt);
        const identity =
          item.arn ||
          (Number.isFinite(created.valueOf())
            ? created.toISOString()
            : String(item.createdAt || item.id));
        const previous = old?.items?.[item.id];
        const current = {
          identity,
          state: item.state,
          ip: item.publicIp || "",
          ipv6: [...(item.ipv6 || [])].sort().join(", "),
        };
        items[item.id] = current;
        if (!previous || previous.identity !== identity) continue;
        if (previous.state !== current.state)
          this.enqueue(
            "status",
            `${stateKey}:${item.id}:state:${this.now()}`,
            "实例状态变化",
            context +
              `实例：${item.name}\n${states[previous.state] || previous.state} → ${states[current.state] || current.state}`,
          );
        if (
          previous.state === "running" &&
          current.state === "running" &&
          (previous.ip !== current.ip || previous.ipv6 !== current.ipv6)
        )
          this.enqueue(
            "ip",
            `${stateKey}:${item.id}:ip:${this.now()}`,
            "公网 IP 变化",
            context +
              `实例：${item.name}\n` +
              [
                previous.ip !== current.ip
                  ? `IPv4：${previous.ip || "—"} → ${current.ip || "—"}`
                  : "",
                previous.ipv6 !== current.ipv6
                  ? `IPv6：${previous.ipv6 || "—"} → ${current.ipv6 || "—"}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
          );
      }
    this.state(stateKey, { error: false, items });
  }
  test() {
    if (!this.ready(this.settings(true)))
      throw Object.assign(Error("请先保存并启用 Telegram 配置"), {
        status: 400,
      });
    const last = this.store.config("telegram-test-at");
    if (last !== null && this.now() - last < 10000)
      throw Object.assign(Error("请等待 10 秒后再发送测试通知"), {
        status: 429,
      });
    const queued = this.enqueue(
      "test",
      "test:" + randomUUID(),
      "Telegram 测试通知",
      "Telegram 通知连接正常。",
      { test: true },
    );
    if (!queued)
      throw Object.assign(Error("通知队列已满，请稍后重试"), { status: 429 });
    this.store.config("telegram-test-at", this.now());
    return { queued: true };
  }
  daily() {
    const n = this.settings(true);
    if (!this.ready(n) || !n.events.includes("daily")) return;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: n.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(this.now())
        .map((p) => [p.type, p.value]),
    );
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (`${parts.hour}:${parts.minute}` < n.reportTime) return;
    if (this.state("daily:" + n.timezone)?.date === date) return;
    const snapshots = this.store.snapshots();
    const accounts = new Map(this.store.accounts().map((a) => [a.id, a.name]));
    const instances = new Map();
    const traffic = new Map();
    for (const row of snapshots) {
      const [path, search] = row.key.split("?");
      const q = new URLSearchParams(search);
      if (
        q.get("accountId") === "all" ||
        q.get("region") === "all" ||
        !accounts.has(q.get("accountId"))
      )
        continue;
      if (path === "/instances" && !row.value.errors?.length)
        for (const i of row.value.items || []) {
          const key = JSON.stringify([i.accountId, i.region, i.id]);
          if (!instances.has(key)) instances.set(key, { ...i, at: row.at });
        }
      if (
        path === "/traffic" &&
        q.get("range") === "month" &&
        !row.value.warnings?.length
      ) {
        const key = JSON.stringify([
          q.get("accountId"),
          q.get("region"),
          q.get("id"),
        ]);
        if (!traffic.has(key)) traffic.set(key, row);
      }
    }
    const items = [...instances.values()];
    const lines = [
      `实例：${items.length} · 运行中：${items.filter((i) => i.state === "running").length} · 已停止：${items.filter((i) => i.state === "stopped").length}`,
    ];
    for (const i of items.slice(0, 5)) {
      const row = traffic.get(JSON.stringify([i.accountId, i.region, i.id]));
      // Do not carry the previous month's traffic across a calendar boundary.
      const offset =
        row &&
        Number(
          new URLSearchParams(row.key.split("?")[1]).get("utcOffsetMinutes") ||
            0,
        );
      const currentMonth =
        row &&
        row.value.start ===
          trafficRange(
            "month",
            new Date(this.now()),
            offset,
          ).start.toISOString();
      const bytes = currentMonth ? row?.value.totals?.combined : undefined;
      lines.push(
        [
          `${notificationRegionFlag(i.region)} ${clip(i.name, 32)} · ${states[i.state] || i.state}`.trim(),
          Number.isFinite(bytes) && bytes >= 0
            ? `本月流量 ${(bytes / 1024 ** 3).toFixed(2)} GB`
            : "流量数据尚未就绪",
          `${clip(accounts.get(i.accountId), 32)} · ${i.region}`,
        ].join("\n"),
      );
    }
    if (!items.length) lines.push("暂无实例采集数据");
    if (items.length > 5)
      lines.push(`另有 ${items.length - 5} 台实例，请查看面板`);
    if (
      this.enqueue(
        "daily",
        `daily:${date}:${n.timezone}`,
        "LightSail 实例日报",
        lines.join("\n\n"),
      )
    )
      this.state("daily:" + n.timezone, { date });
  }
  kick() {
    if (!this.timer || this.closed) return;
    void this.tick().catch(() => {
      if (!this.closed) console.error("Telegram：通知任务执行失败");
    });
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), 2000);
    this.timer.unref();
    this.kick();
  }
  async tick() {
    if (this.closed || this.running) return;
    this.running = true;
    try {
      if (!this.reportCheckedAt || this.now() - this.reportCheckedAt >= 60000) {
        this.reportCheckedAt = this.now();
        this.daily();
      }
      const rows = this.store.db
        .prepare(
          "SELECT body FROM notification_outbox WHERE json_extract(body,'$.status')='queued' AND json_extract(body,'$.nextAt')<=? ORDER BY at,rowid LIMIT 3",
        )
        .all(this.now());
      for (const row of rows) {
        if (this.closed) return;
        const item = JSON.parse(row.body);
        if (this.now() - Date.parse(item.at) > 86400000) {
          this.put({
            ...item,
            status: "skipped",
            error: "通知超过 24 小时，已过期",
          });
          continue;
        }
        const n = this.settings(true);
        if (
          !this.ready(n) ||
          this.destination(n) !== item.destination ||
          (item.type !== "test" && !n.events.includes(item.type))
        ) {
          this.put({
            ...item,
            status: "skipped",
            error: "通知已关闭、类型已取消或接收配置已更改",
          });
          continue;
        }
        if (this.now() < (this.store.config("telegram-retry-at") || 0)) break;
        if (this.now() < item.nextAt) continue;
        try {
          await this.send(
            n,
            formatNotification(item, true, n.timezone),
            this.abort.signal,
          );
          if (this.closed) return;
          this.put({
            ...item,
            status: "sent",
            attempts: item.attempts + 1,
            sentAt: new Date(this.now()).toISOString(),
            error: undefined,
          });
          this.store.audit({
            action: "notification-sent",
            target: item.title,
            detail: "Telegram 通知已发送",
          });
        } catch (e) {
          if (this.closed) return;
          const attempts = item.attempts + 1;
          const retryAt = e.retryAfter ? this.now() + e.retryAfter * 1000 : 0;
          if (retryAt) this.store.config("telegram-retry-at", retryAt);
          const failed = attempts >= 5 || e.permanent;
          const error = safeError(e, n.telegramToken);
          this.put({
            ...item,
            status: failed ? "failed" : "queued",
            attempts,
            error,
            nextAt: Math.max(
              retryAt,
              this.now() + Math.min(3600000, 30000 * 2 ** (attempts - 1)),
            ),
          });
          this.store.audit({
            action: failed ? "notification-failed" : "notification-retry",
            target: item.title,
            status: "failed",
            detail: `${error}；${failed ? "已停止重试" : "等待自动重试"}`,
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
