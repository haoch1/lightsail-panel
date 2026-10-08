import {
  AUTO_REFRESH_MS,
  isResourcePath,
} from "../../shared/refresh-policy.ts";
type Entry = { value?: unknown; expires: number; pending?: Promise<unknown> };
type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Session-scoped resource snapshots. Writes and identity changes invalidate them. */
export class ResourceCache {
  private entries = new Map<string, Entry>();
  private failures = new Map<string, number>();
  private ttl: number;
  private now: () => number;
  private storage?: CacheStorage;
  private storageKey?: string;
  constructor(ttl = 15_000, now = Date.now) {
    this.ttl = ttl;
    this.now = now;
  }

  restore(storage: CacheStorage, key: string) {
    this.entries.clear();
    this.failures.clear();
    if (this.storageKey && this.storageKey !== key)
      this.storage?.removeItem(this.storageKey);
    this.storage = storage;
    this.storageKey = key;
    try {
      const saved: [string, Entry][] = JSON.parse(storage.getItem(key) || "[]");
      for (const [path, entry] of saved)
        if (
          isResourcePath(path) &&
          entry.value !== undefined &&
          entry.expires > this.now() - 86_400_000
        )
          this.entries.set(path, {
            value: entry.value,
            expires: entry.expires,
          });
    } catch {
      /* Storage can be disabled or an older snapshot can be malformed. */
    }
  }

  private persist() {
    if (!this.storageKey) return;
    try {
      this.storage?.setItem(
        this.storageKey,
        JSON.stringify(
          [...this.entries]
            .filter(
              ([path, entry]) =>
                isResourcePath(path) && entry.value !== undefined,
            )
            .map(([path, entry]) => [
              path,
              { value: entry.value, expires: entry.expires },
            ]),
        ),
      );
    } catch {
      /* Memory and server caching still work when browser storage is full. */
    }
  }

  nextExpiry(matches: (key: string) => boolean): number | undefined {
    const deadlines = [...this.entries]
      .filter(
        ([key, entry]) => matches(key) && entry.expires > 0 && !entry.pending,
      )
      .map(([, entry]) => entry.expires);
    deadlines.push(
      ...[...this.failures]
        .filter(([key]) => matches(key))
        .map(([, deadline]) => deadline),
    );
    return deadlines.length ? Math.min(...deadlines) : undefined;
  }

  peek<T>(key: string, allowStale = false): T | undefined {
    const entry = this.entries.get(key);
    return entry && (allowStale || entry.expires > this.now())
      ? (entry.value as T)
      : undefined;
  }

  matching<T>(prefix: string, allowStale = false): [string, T][] {
    const values: [string, T][] = [];
    for (const [key, entry] of this.entries)
      if (
        key.startsWith(prefix) &&
        (allowStale || entry.expires > this.now()) &&
        entry.value !== undefined
      )
        values.push([key, entry.value as T]);
    return values;
  }

  async load<T>(
    key: string,
    loader: () => Promise<T>,
    force = false,
    ttl = this.ttl,
  ): Promise<T> {
    const previous = this.entries.get(key);
    if (!force && previous) {
      if (previous.pending) return previous.pending as Promise<T>;
      if (previous.expires > this.now()) return previous.value as T;
    }
    const entry: Entry = { expires: 0, value: previous?.value };
    this.failures.delete(key);
    const pending = loader().then(
      (value) => {
        // An older request must never overwrite a refreshed or invalidated entry.
        if (this.entries.get(key) === entry) {
          entry.value = value;
          const serverDeadline = (value as { cacheExpiresAt?: number } | null)
            ?.cacheExpiresAt;
          entry.expires =
            typeof serverDeadline === "number"
              ? serverDeadline
              : this.now() + ttl;
          entry.pending = undefined;
          this.persist();
        }
        return value;
      },
      (error) => {
        if (this.entries.get(key) === entry) {
          this.entries.delete(key);
          this.failures.set(key, this.now() + ttl);
          this.persist();
        }
        throw error;
      },
    );
    entry.pending = pending;
    this.entries.set(key, entry);
    return pending;
  }

  clear() {
    this.entries.clear();
    this.failures.clear();
    this.persist();
  }
}

export const resourceCache = new ResourceCache(AUTO_REFRESH_MS);
