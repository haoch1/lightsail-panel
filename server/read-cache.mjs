import { AUTO_REFRESH_MS, nextRefreshAt } from "../shared/refresh-policy.ts";

/** Shares AWS reads across page reloads and tabs; includes in-flight and failed reads. */
export class ReadCache {
  constructor(ttl = AUTO_REFRESH_MS, now = Date.now) {
    this.ttl = ttl;
    this.now = now;
    this.entries = new Map();
  }
  load(key, loader, force = false) {
    const previous = this.entries.get(key);
    if (previous?.pending || (!force && previous?.expires > this.now()))
      return previous.promise;
    const entry = { pending: true, expires: 0 };
    entry.promise = Promise.resolve()
      .then(loader)
      .then(
        (value) => {
          entry.pending = false;
          entry.expires =
            this.ttl === AUTO_REFRESH_MS
              ? nextRefreshAt(this.now())
              : this.now() + this.ttl;
          return { ...value, cacheExpiresAt: entry.expires };
        },
        (error) => {
          entry.pending = false;
          entry.expires =
            this.ttl === AUTO_REFRESH_MS
              ? nextRefreshAt(this.now())
              : this.now() + this.ttl;
          throw error;
        },
      );
    if (this.entries.size >= 5000)
      this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, entry);
    return entry.promise;
  }
  read(req, loader) {
    const params = new URLSearchParams(
      Object.entries(req.query).filter(([key]) => key !== "refresh"),
    );
    params.sort();
    const key = req.path + "?" + params;
    const entry = this.entries.get(key);
    req.res?.setHeader(
      "X-Panel-Cache",
      entry?.pending ||
        (req.query.refresh !== "1" && entry?.expires > this.now())
        ? "hit"
        : "miss",
    );
    return this.load(key, loader, req.query.refresh === "1");
  }
  clear() {
    this.entries.clear();
  }
  invalidate(matches) {
    for (const key of this.entries.keys())
      if (matches(key)) this.entries.delete(key);
  }
}
