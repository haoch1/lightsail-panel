import { useCallback, useEffect, useRef, useState } from "react";
import type { Catalog, Instance, TrafficData } from "../../shared/types";
import { api } from "../lib/api";
import { resourceCache } from "../lib/resource-cache";
import { requestPool } from "../lib/resource-scan";
import { AUTO_REFRESH_MS, refreshPath } from "../../shared/refresh-policy";
import { useAutoRefresh } from "./useAutoRefresh";
import {
  instanceBundle,
  instanceKey,
  monthlyTrafficPath,
  pricePath,
} from "../lib/instance-usage";

export type InstanceUsage = {
  price?: number | null;
  traffic?: number | null;
  inbound?: number | null;
  outbound?: number | null;
  priceError?: string;
  trafficError?: string;
  trafficAt?: string;
};
const schedule = requestPool(4);

/** Enrich visible resources independently; scans never wait for metrics or prices. */
export function useInstanceUsage(instances: Instance[]) {
  const [values, setValues] = useState<Record<string, InstanceUsage>>({});
  const [revision, revise] = useState({ version: 0, manual: false });
  const { version } = revision;
  const refresh = useCallback(
    () => revise((r) => ({ version: r.version + 1, manual: true })),
    [],
  );
  const previousVersion = useRef(version);
  const rowsKey = JSON.stringify(
    instances.map((i) => [i.accountId, i.region, i.id, i.instanceType]),
  );
  const offset = -new Date().getTimezoneOffset();
  const month = new Date().getFullYear() + ":" + new Date().getMonth();
  const paths = new Set(
    instances.flatMap((i) => [pricePath(i), monthlyTrafficPath(i, offset)]),
  );
  useAutoRefresh(
    () => revise((r) => ({ version: r.version + 1, manual: false })),
    resourceCache.nextExpiry((key) => paths.has(key)),
  );
  useEffect(() => {
    let active = true;
    const force = revision.manual && previousVersion.current !== version;
    previousVersion.current = version;
    const publish = (key: string, value: InstanceUsage) => {
      if (active)
        setValues((current) => ({
          ...current,
          [key]: { ...current[key], ...value },
        }));
    };
    const catalogs = new Map<string, Promise<Catalog>>();
    for (const i of instances) {
      const key = instanceKey(i);
      const catalogPath = pricePath(i);
      // Shared catalog keys deduplicate prices for all instances in a region.
      if (!catalogs.has(catalogPath))
        catalogs.set(
          catalogPath,
          resourceCache.load(
            catalogPath,
            () => schedule(() => api<Catalog>(refreshPath(catalogPath, force))),
            force,
            AUTO_REFRESH_MS,
          ),
        );
      void catalogs
        .get(catalogPath)!
        .then((catalog) =>
          publish(key, {
            price: instanceBundle(catalog, i)?.price ?? null,
            priceError: undefined,
          }),
        )
        .catch((error: Error) =>
          publish(key, { price: null, priceError: error.message }),
        );
      const path = monthlyTrafficPath(i, offset);
      void resourceCache
        .load(
          path,
          () => schedule(() => api<TrafficData>(refreshPath(path, force))),
          force,
          AUTO_REFRESH_MS,
        )
        .then((data) =>
          publish(key, {
            traffic: data.totals.combined,
            inbound: data.totals.inbound,
            outbound: data.totals.outbound,
            trafficAt: data.at,
            trafficError: data.warnings.join("；") || undefined,
          }),
        )
        .catch((error: Error) =>
          publish(key, { traffic: null, trafficError: error.message }),
        );
    }
    return () => {
      active = false;
    };
  }, [rowsKey, version, offset, month]);
  return { values, refresh };
}
