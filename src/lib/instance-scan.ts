import type { Instance } from "../../shared/types";
import type { ResourceCache } from "./resource-cache.ts";
import { cachedResourceScan, loadResourceScan } from "./resource-scan.ts";
import type { ResourceScope, ScanSource } from "./resource-scan.ts";

export type InstanceScope = ResourceScope;
export const instanceSource: ScanSource<Instance> = {
  prefix: "/instances?",
  path: (accountId, region) =>
    "/instances?" +
    new URLSearchParams({ accountId, region, service: "lightsail" }),
  normalize: (data) => data,
};
export const cachedInstanceScan = (
  cache: ResourceCache,
  scope: InstanceScope,
) => cachedResourceScan(cache, scope, instanceSource);
export const loadInstanceScan = (
  cache: ResourceCache,
  scope: InstanceScope,
  request: Parameters<typeof loadResourceScan<Instance>>[3],
  update: Parameters<typeof loadResourceScan<Instance>>[4],
  force = false,
) => loadResourceScan(cache, scope, instanceSource, request, update, force);
