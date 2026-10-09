import { useCallback, useEffect, useRef, useState } from "react";
import type { ResourceScan } from "../../shared/types";
import { api } from "../lib/api";
import { cachedResourceScan, loadResourceScan } from "../lib/resource-scan";
import type { ResourceScope, ScanSource } from "../lib/resource-scan";
import { resourceCache } from "../lib/resource-cache";
import { useAutoRefresh } from "./useAutoRefresh";
import { matchesUpdate } from "../../shared/resource-update";

export function useResourceScan<T>(
  scope: ResourceScope,
  source: ScanSource<T>,
) {
  const { accounts, accountId, region } = scope;
  const scopeKey = JSON.stringify([
    accountId,
    region,
    accounts.map((account) => [account.id, account.name, account.region]),
  ]);
  const [snapshot, setSnapshot] = useState<{
    scopeKey: string;
    data?: ResourceScan<T>;
    loading: boolean;
  }>(() => ({
    scopeKey,
    data: cachedResourceScan(resourceCache, scope, source),
    loading: accounts.length > 0,
  }));
  const [revision, revise] = useState({ version: 0, manual: false });
  const { version } = revision;
  const previous = useRef({ scopeKey, version });
  useEffect(() => {
    const updated = (event: Event) => {
      const change = (event as CustomEvent).detail;
      if (
        accounts.some(
          (account) =>
            (accountId === "all" || account.id === accountId) &&
            matchesUpdate(source.path(account.id, region), change),
        )
      )
        revise((r) => ({ version: r.version + 1, manual: false }));
    };
    window.addEventListener("panel:resources-updated", updated);
    return () => window.removeEventListener("panel:resources-updated", updated);
  }, [scopeKey, source]);
  const refresh = useCallback(
    () => revise((r) => ({ version: r.version + 1, manual: true })),
    [],
  );
  useAutoRefresh(
    () => revise((r) => ({ version: r.version + 1, manual: false })),
    !snapshot.loading && accounts.length
      ? resourceCache.nextExpiry((key) => {
          if (!key.startsWith(source.prefix)) return false;
          const params = new URLSearchParams(key.split("?")[1]);
          return (
            accounts.some((a) => a.id === params.get("accountId")) &&
            (accountId === "all" || accountId === params.get("accountId")) &&
            (region === "all" || region === params.get("region"))
          );
        })
      : undefined,
  );

  useEffect(() => {
    let active = true;
    const force =
      revision.manual &&
      previous.current.scopeKey === scopeKey &&
      previous.current.version !== version;
    previous.current = { scopeKey, version };
    void loadResourceScan(
      resourceCache,
      { accounts, accountId, region },
      source,
      api,
      (data, loading) => {
        if (active)
          setSnapshot((current) => ({
            scopeKey,
            data:
              data ||
              (current.scopeKey === scopeKey ? current.data : undefined),
            loading,
          }));
      },
      force,
    );
    return () => {
      active = false;
    };
    // scopeKey encodes the fields used by the scan. A new array with identical
    // accounts (including an empty array) must not restart the effect.
  }, [scopeKey, version, source]);

  // Filter shared cached results during render so switching never flashes old scope rows.
  const current =
    snapshot.scopeKey === scopeKey
      ? snapshot
      : {
          data: cachedResourceScan(resourceCache, scope, source),
          loading: accounts.length > 0,
        };
  return { ...current, refresh };
}
