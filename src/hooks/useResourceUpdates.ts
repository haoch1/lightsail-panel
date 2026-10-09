import { useEffect, useSyncExternalStore } from "react";
import type { LaunchNetworkJob } from "../../shared/types";
import { api } from "../lib/api";
import { resourceCache } from "../lib/resource-cache";
import { matchesUpdate } from "../../shared/resource-update";
let jobs: LaunchNetworkJob[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useOperationJobs = () =>
  useSyncExternalStore(subscribe, () => jobs);

/** Progress reads are local; AWS polling is restricted to pending operations on the server. */
export function useResourceUpdates(enabled: boolean, demo: boolean) {
  useEffect(() => {
    jobs = [];
    for (const listener of listeners) listener();
    if (!enabled) return;
    let live = true,
      busy = false,
      requested = false;
    let timer: ReturnType<typeof setTimeout>;
    let seen: Record<string, string> = {};
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("panel:operation-status") || "{}",
      );
      if (saved && typeof saved === "object" && !Array.isArray(saved))
        seen = saved;
    } catch {}
    async function load() {
      if (!live) return;
      clearTimeout(timer);
      if (busy) {
        requested = true;
        return;
      }
      if (document.hidden) {
        timer = setTimeout(load, 30000);
        return;
      }
      busy = true;
      try {
        const result = await api<{ items: LaunchNetworkJob[] }>(
          "/launch/network",
        );
        if (!live) return;
        jobs = result.items;
        for (const listener of listeners) listener();
        for (const job of jobs) {
          const progress = JSON.stringify([
            job.status,
            job.instances.map((item) => [item.name, item.stage, item.detail]),
          ]);
          if (seen[job.id] !== progress) {
            const update = {
              accountId: job.accountId,
              region: job.region,
              resources: job.resources || ["instances", "static-ips", "ports"],
            };
            resourceCache.invalidate((path) => matchesUpdate(path, update));
            window.dispatchEvent(
              new CustomEvent("panel:resources-updated", { detail: update }),
            );
          }
          seen[job.id] = progress;
        }
        seen = Object.fromEntries(jobs.map((job) => [job.id, seen[job.id]]));
        try {
          sessionStorage.setItem(
            "panel:operation-status",
            JSON.stringify(seen),
          );
        } catch {}
      } catch {
        /* Reconnect without removing visible progress. */
      } finally {
        busy = false;
      }
      if (live) {
        timer = setTimeout(
          load,
          requested
            ? 0
            : jobs.some((job) => job.status === "pending")
              ? 5000
              : 30000,
        );
        requested = false;
      }
    }
    const changed = () => {
      void load();
    };
    const visible = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener("panel:mutation", changed);
    document.addEventListener("visibilitychange", visible);
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener("panel:mutation", changed);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, demo]);
}
