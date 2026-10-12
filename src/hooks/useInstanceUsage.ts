import { useCallback, useEffect, useRef, useState } from "react";
import type { Catalog, Instance, TrafficData } from "../../shared/types";
import { api } from "../lib/api";
import { resourceCache } from "../lib/resource-cache";
import { requestPool } from "../lib/resource-scan";
import { AUTO_REFRESH_MS, refreshPath } from "../../shared/refresh-policy";
import { useAutoRefresh } from "./useAutoRefresh";
import { matchesUpdate } from "../../shared/resource-update";
import {
  instanceBundle,
  instanceKey,
  monthlyTrafficPath,
  pricePath,
} from "../lib/instance-usage";

export type InstanceUsage = {
  price?: number | null;
  allowance?: number | null;
  traffic?: number | null;
  inbound?: number | null;
  outbound?: number | null;
  priceError?: string;
  trafficError?: string;
  trafficAt?: string;
  trafficPeriod?: string;
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
  useEffect(() => {
    const updated = (event: Event) => {
      if (
        [...paths].some((path) =>
          matchesUpdate(path, (event as CustomEvent).detail),
        )
      )
        revise((r) => ({ version: r.version + 1, manual: false }));
    };
    window.addEventListener("panel:resources-updated", updated);
    return () => window.removeEventListener("panel:resources-updated", updated);
  }, [rowsKey, offset]);
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
    const catalogs = new Map<string, Promise<Pick<Catalog, "types">>>();
    for (const i of instances) {
      const key = instanceKey(i);
      const catalogPath = pricePath(i);
      // Price reads share the lightweight regional bundle snapshot.
      if (!catalogs.has(catalogPath))
        catalogs.set(
          catalogPath,
          resourceCache.load(
            catalogPath,
            () =>
              schedule(() =>
                api<Pick<Catalog, "types">>(refreshPath(catalogPath, force)),
              ),
            force,
            AUTO_REFRESH_MS,
          ),
        );
      void catalogs
        .get(catalogPath)!
        .then((catalog) => {
          const bundle = instanceBundle(catalog, i);
          publish(key, {
            price: bundle?.price ?? null,
            allowance:
              bundle?.transfer && bundle.transfer > 0
                ? bundle.transfer * 1024 ** 3
                : null,
            priceError: undefined,
          });
        })
        .catch((error: Error) =>
          publish(key, {
            priceError: error.message,
          }),
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
            trafficPeriod: month,
            trafficError: data.warnings.join("；") || undefined,
          }),
        )
        .catch((error: Error) => publish(key, { trafficError: error.message }));
    }
    return () => {
      active = false;
    };
  }, [rowsKey, version, offset, month]);
  const displayed = { ...values };
  for (const instance of instances) {
    const key = instanceKey(instance);
    if (displayed[key]?.trafficPeriod && displayed[key].trafficPeriod !== month)
      displayed[key] = {
        ...displayed[key],
        traffic: undefined,
        inbound: undefined,
        outbound: undefined,
        trafficAt: undefined,
        trafficError: undefined,
      };
    const catalog = resourceCache.peek<Pick<Catalog, "types">>(
      pricePath(instance),
    );
    const traffic = resourceCache.peek<TrafficData>(
      monthlyTrafficPath(instance, offset),
    );
    const bundle = catalog && instanceBundle(catalog, instance);
    displayed[key] = {
      ...displayed[key],
      ...(catalog && {
        price: bundle?.price ?? null,
        allowance: bundle?.transfer ? bundle.transfer * 1024 ** 3 : null,
      }),
      ...(traffic && {
        traffic: traffic.totals.combined,
        inbound: traffic.totals.inbound,
        outbound: traffic.totals.outbound,
        trafficAt: traffic.at,
        trafficError: traffic.warnings.join("；") || undefined,
      }),
    };
  }
  return { values: displayed, refresh };
}
