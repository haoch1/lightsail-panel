import { AUTO_REFRESH_MS, nextRefreshAt } from "../shared/refresh-policy.ts";
import { trafficRange } from "../shared/traffic.mjs";
import { scrubError } from "./aws/shared.mjs";

export function snapshotKey(path, query) {
  path = path.replace(/^\/api(?=\/)/, "");
  const params = new URLSearchParams(
    Object.entries(query).filter(([key]) => key !== "refresh"),
  );
  if (!params.has("service")) params.set("service", "lightsail");
  if (path === "/traffic") {
    if (!params.has("range")) params.set("range", "month");
    if (!params.has("utcOffsetMinutes")) params.set("utcOffsetMinutes", "0");
  }
  params.sort();
  return path + "?" + params;
}

/** Durable successful reads; stale snapshots are served while bounded workers refresh them. */
export class ResourceSnapshots {
  constructor(store, gateway, { now = Date.now } = {}) {
    this.store = store;
    this.gateway = gateway;
    this.now = now;
    this.entries = new Map(
      store.snapshots().map((row) => [
        row.key,
        {
          value: row.value,
          at: row.at,
          expires: row.expires,
        },
      ]),
    );
    this.active = 0;
    this.queue = [];
    this.stopped = false;
    this.stop = this.stop.bind(this);
    store.onClose.add(this.stop);
  }
  ttl(key) {
    return key.startsWith("/regions?")
      ? 15 * 60_000
      : /^\/(?:bundles|catalog)\?/.test(key)
        ? 60 * 60_000
        : AUTO_REFRESH_MS;
  }
  usable(key, entry) {
    if (!entry?.value) return false;
    if (!key.startsWith("/traffic?")) return true;
    const q = new URLSearchParams(key.split("?")[1]);
    // A previous day's/month's total must never be displayed as the current period.
    const start = trafficRange(
      q.get("range"),
      new Date(this.now()),
      Number(q.get("utcOffsetMinutes")),
    ).start.toISOString();
    return !entry.value.start || entry.value.start === start;
  }
  view(key, entry) {
    const value = { ...entry.value };
    if (entry.error) {
      if (key.startsWith("/instances?")) {
        const q = new URLSearchParams(key.split("?")[1]);
        value.errors = [
          {
            account:
              this.store.accounts().find((a) => a.id === q.get("accountId"))
                ?.name || "AWS",
            region: q.get("region"),
            message: entry.error,
          },
        ];
      } else if (key.startsWith("/traffic?"))
        value.warnings = [...(value.warnings || []), entry.error];
    }
    return {
      ...value,
      // A stale response gets a short browser recheck deadline, never an expired
      // deadline that would cause an immediate refresh loop while AWS is pending.
      cacheExpiresAt:
        entry.expires > this.now() ? entry.expires : this.now() + 30_000,
      snapshotAt: entry.at,
      snapshotStale: !!entry.error || entry.expires <= this.now(),
      snapshotRefreshing: !!entry.pending,
      snapshotError: entry.error || undefined,
    };
  }
  schedule(task, key, priority) {
    return new Promise((resolve, reject) => {
      this.queue[priority ? "unshift" : "push"]({ task, key, resolve, reject });
      this.drain();
    });
  }
  drain() {
    while (!this.stopped && this.active < 4 && this.queue.length) {
      const { task, resolve, reject } = this.queue.shift();
      this.active++;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
  async load(key, loader = this.loader(key), force = false, priority = false) {
    if (this.stopped) throw Error("面板已停止");
    this.checkAccount(key);
    let entry = this.entries.get(key);
    if (entry?.pending) {
      const index = this.queue.findIndex((task) => task.key === key);
      if (priority && index > 0)
        this.queue.unshift(...this.queue.splice(index, 1));
      return entry.pending;
    }
    if (!force && entry?.expires > this.now() && this.usable(key, entry))
      return this.view(key, entry);
    if (!force && entry?.expires > this.now() && entry?.error)
      throw Error(entry.error);
    if (!this.usable(key, entry)) entry = { expires: 0 };
    entry ||= { expires: 0 };
    this.entries.set(key, entry);
    if (this.entries.size > 5000) {
      const oldest = [...this.entries].find(
        ([k, e]) => k !== key && !e.pending,
      );
      if (oldest) {
        this.entries.delete(oldest[0]);
        this.store.deleteSnapshot(oldest[0]);
      }
    }
    entry.pending = this.schedule(loader, key, priority)
      .then((value) => {
        const problems = [
          ...(value.errors || []).map((e) => e.message),
          ...(value.warnings || []),
        ];
        if (problems.length)
          throw Object.assign(Error(problems.join("；")), { result: value });
        if (!this.stopped && this.entries.get(key) === entry) {
          entry.value = value;
          entry.error = undefined;
          entry.at = this.now();
          entry.expires = nextRefreshAt(this.now(), this.ttl(key));
          const q = new URLSearchParams(key.split("?")[1]);
          this.store.saveSnapshot(
            key,
            q.get("accountId"),
            entry.at,
            entry.expires,
            value,
          );
          this.store.emit("snapshot:" + encodeURIComponent(key));
        }
        return value;
      })
      .catch((error) => {
        if (!this.stopped && this.entries.get(key) === entry) {
          entry.error = scrubError(error);
          entry.expires = nextRefreshAt(this.now());
          if (!entry.value && error.result) entry.value = error.result;
          this.store.emit("snapshot:" + encodeURIComponent(key));
        }
        if (!entry.value) throw error;
        return entry.value;
      })
      .then(() => this.view(key, entry))
      .finally(() => {
        entry.pending = undefined;
      });
    return entry.pending;
  }
  read(req, loader) {
    const key = snapshotKey(req.path, req.query);
    this.checkAccount(key);
    const entry = this.entries.get(key);
    const force = req.query.refresh === "1";
    const available = this.usable(key, entry);
    req.res?.setHeader("X-Panel-Cache", available ? "hit" : "miss");
    if (!force && available) {
      if (entry.expires <= this.now())
        void this.load(key, loader, false, true).catch(() => {});
      return Promise.resolve(this.view(key, entry));
    }
    return this.load(key, loader, force, true);
  }
  checkAccount(key) {
    const id = new URLSearchParams(key.split("?")[1]).get("accountId");
    if (id !== "all" && !this.store.accounts().some((a) => a.id === id))
      throw Object.assign(Error("AWS 账户不存在"), { status: 404 });
  }
  loader(key) {
    const [path, search] = key.split("?");
    const q = Object.fromEntries(new URLSearchParams(search));
    const target = {
      accountId: q.accountId,
      region: q.region,
      id: q.id,
      service: "lightsail",
    };
    if (path === "/regions")
      return async () => ({
        items: await this.gateway.regions(
          this.store.account(q.accountId),
          "lightsail",
        ),
      });
    if (path === "/instances")
      return () =>
        this.gateway.scan(
          q.accountId === "all"
            ? this.store.accounts().map((a) => a.id)
            : [q.accountId],
          "lightsail",
          q.region,
        );
    if (path === "/bundles")
      return () => this.gateway.bundles(q.accountId, "lightsail", q.region);
    if (path === "/catalog")
      return () => this.gateway.catalog(q.accountId, "lightsail", q.region);
    if (path === "/traffic")
      return () =>
        this.gateway.traffic(
          target,
          q.range,
          new Date(this.now()),
          Number(q.utcOffsetMinutes),
        );
    if (path === "/ports") return () => this.gateway.ports(target);
    if (path === "/static-ips")
      return async () => ({
        items: await this.gateway.staticIps(q.accountId, q.region),
        at: new Date(this.now()).toISOString(),
      });
    throw Error("不支持的资源快照");
  }
  invalidate(matches) {
    for (const [key, old] of this.entries)
      if (matches("/api" + key)) {
        const entry = { value: old.value, at: old.at, expires: 0 };
        this.entries.set(key, entry);
        this.store.expireSnapshot(key);
        void this.load(key).catch(() => {});
      }
  }
  accountsChanged() {
    const ids = new Set(this.store.accounts().map((a) => a.id));
    for (const key of this.entries.keys()) {
      const id = new URLSearchParams(key.split("?")[1]).get("accountId");
      if (id === "all" || !ids.has(id)) this.entries.delete(key);
    }
    if (this.collecting) this.recollect = true;
    else void this.collect();
  }
  start() {
    // Tests with partial gateways do not start unrelated cloud work.
    if (
      !["scan", "regions", "bundles", "traffic"].every(
        (name) => typeof this.gateway[name] === "function",
      )
    )
      return;
    void this.collect();
    const tick = () => {
      if (this.stopped) return;
      this.timer = setTimeout(
        () => {
          void this.collect();
          tick();
        },
        nextRefreshAt(this.now()) - this.now() + 50,
      );
      this.timer.unref();
    };
    tick();
  }
  async collect() {
    if (this.stopped || this.collecting) return this.collecting;
    if (
      typeof this.gateway.scan !== "function" ||
      typeof this.gateway.bundles !== "function"
    )
      return;
    const attempt = (key) =>
      this.load(key).catch(() => this.entries.get(key)?.value);
    const key = (path, q) => snapshotKey(path, q);
    this.collecting = (async () => {
      // Previously requested ranges, timezones and details remain available without a browser.
      const existing = [...this.entries.keys()];
      const work = this.store.accounts().map(async (account) => {
        const base = { accountId: account.id, service: "lightsail" };
        const scanRegion = async (region) => {
          const q = { ...base, region };
          const result = await attempt(key("/instances", q));
          if (this.stopped) return;
          if (result && !result.errors?.length && !result.snapshotError) {
            const ids = new Set(result.items.map((item) => item.id));
            for (const saved of this.entries.keys()) {
              const p = new URLSearchParams(saved.split("?")[1]);
              if (
                /^\/(?:traffic|ports)\?/.test(saved) &&
                p.get("accountId") === account.id &&
                p.get("region") === region &&
                !ids.has(p.get("id"))
              ) {
                this.entries.delete(saved);
                this.store.deleteSnapshot(saved);
              }
            }
          }
          const tasks = [];
          if (typeof this.gateway.staticIps === "function")
            tasks.push(attempt(key("/static-ips", q)));
          if (result?.items?.length) {
            tasks.push(attempt(key("/bundles", q)));
            for (const item of result.items) {
              const offsets = new Set([
                String(-new Date(this.now()).getTimezoneOffset()),
              ]);
              for (const saved of existing) {
                const p = new URLSearchParams(saved.split("?")[1]);
                if (
                  saved.startsWith("/traffic?") &&
                  p.get("accountId") === account.id &&
                  p.get("region") === region &&
                  p.get("id") === item.id
                )
                  offsets.add(p.get("utcOffsetMinutes"));
              }
              for (const offset of offsets)
                tasks.push(
                  attempt(
                    key("/traffic", {
                      ...q,
                      id: item.id,
                      range: "month",
                      utcOffsetMinutes: offset,
                    }),
                  ),
                );
            }
          }
          await Promise.all(tasks);
        };
        const preferred = scanRegion(account.region);
        const regions = await attempt(key("/regions", base));
        if (this.stopped) return;
        const others = [
          ...new Set((regions?.items || []).map((r) => r.id)),
        ].filter((r) => r !== account.region);
        const known = others.filter(
          (r) =>
            this.entries.get(key("/instances", { ...base, region: r }))?.value
              ?.items?.length,
        );
        await Promise.all([preferred, ...known.map(scanRegion)]);
        if (!this.stopped)
          await Promise.all(
            others.filter((r) => !known.includes(r)).map(scanRegion),
          );
      });
      const subscribed = existing.filter(
        (k) => !/^\/(?:instances|regions|bundles|static-ips)\?/.test(k),
      );
      await Promise.all([...work, ...subscribed.map(attempt)]);
    })()
      .catch(() => {})
      .finally(() => {
        this.collecting = undefined;
        if (this.recollect && !this.stopped) {
          this.recollect = false;
          void this.collect();
        }
      });
    return this.collecting;
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const task of this.queue.splice(0)) task.reject(Error("面板已停止"));
    this.store.onClose.delete(this.stop);
  }
}
