import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { resourceCache } from "../lib/resource-cache";
import { nextSnapshot } from "../lib/api-snapshot";
import type { ApiSnapshot } from "../lib/api-snapshot";
import { isResourcePath, refreshPath } from "../../shared/refresh-policy";
import { useAutoRefresh } from "./useAutoRefresh";
import { matchesUpdate } from "../../shared/resource-update";

export function useApi<T>(
  path: string | null,
  options: { retainKey?: string } = {},
) {
  const { retainKey } = options;
  const [snapshot, setSnapshot] = useState<ApiSnapshot<T>>({
    path,
    retainKey,
    error: "",
    loading: !!path,
  });
  const [revision, revise] = useState({ version: 0, manual: false });
  const { version } = revision;
  const previous = useRef({ path, version });
  useEffect(() => {
    const updated = (event: Event) => {
      if (path && matchesUpdate(path, (event as CustomEvent).detail))
        revise((r) => ({ version: r.version + 1, manual: false }));
    };
    window.addEventListener("panel:resources-updated", updated);
    return () => window.removeEventListener("panel:resources-updated", updated);
  }, [path]);
  const refresh = useCallback(
    () => revise((r) => ({ version: r.version + 1, manual: true })),
    [],
  );
  useAutoRefresh(
    () => revise((r) => ({ version: r.version + 1, manual: false })),
    path && isResourcePath(path) && !snapshot.loading
      ? resourceCache.nextExpiry((key) => key === path)
      : undefined,
  );

  useEffect(() => {
    let active = true;
    const force =
      revision.manual &&
      previous.current.path === path &&
      previous.current.version !== version;
    previous.current = { path, version };
    if (!path) {
      setSnapshot({ path, retainKey, error: "", loading: false });
      return;
    }
    const cached = force ? undefined : resourceCache.peek<T>(path);
    setSnapshot((current) => nextSnapshot(current, path, retainKey, cached));
    resourceCache
      .load(path, () => api<T>(refreshPath(path, force)), force)
      .then((data) => {
        if (active)
          setSnapshot({
            path,
            retainKey,
            dataPath: path,
            data,
            error: "",
            loading: false,
          });
      })
      .catch((error) => {
        if (active)
          setSnapshot((current) => ({
            ...current,
            path,
            error: error.message,
            loading: false,
          }));
      });
    return () => {
      active = false;
    };
  }, [path, retainKey, version]);

  const current =
    snapshot.path === path && snapshot.retainKey === retainKey
      ? snapshot
      : nextSnapshot(
          snapshot,
          path,
          retainKey,
          path ? resourceCache.peek<T>(path) : undefined,
        );
  return {
    ...current,
    previousData: !!current.dataPath && current.dataPath !== path,
    refresh,
  };
}
