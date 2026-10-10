import type { Account, Region, ResourceScan } from "../../shared/types";
import type { ResourceCache } from "./resource-cache";
import { optInRegionIds } from "../../shared/regions.ts";
import { AUTO_REFRESH_MS, refreshPath } from "../../shared/refresh-policy.ts";
import { isConnectionError, ApiError } from "./api-error.ts";

export type ResourceScope = {
  accounts: Account[];
  accountId: string;
  region: string;
};
type ReadApi = <T>(path: string) => Promise<T>;
export type ScanSource<T> = {
  path: (accountId: string, region: string) => string;
  prefix: string;
  normalize: (
    data: ResourceScan<T>,
    account: Account,
    region: string,
  ) => ResourceScan<T>;
};

const regionPath = (accountId: string) =>
  `/regions?accountId=${encodeURIComponent(accountId)}&service=lightsail`;
const scopeAccounts = ({ accounts, accountId }: ResourceScope) =>
  accounts.filter((account) => accountId === "all" || account.id === accountId);

function cachedRows<T>(
  cache: ResourceCache,
  scope: ResourceScope,
  source: ScanSource<T>,
) {
  const ids = new Set(scopeAccounts(scope).map((account) => account.id));
  return new Map(
    cache.matching<ResourceScan<T>>(source.prefix, true).filter(([path]) => {
      const query = new URLSearchParams(path.split("?")[1]);
      const region = query.get("region");
      return (
        ids.has(query.get("accountId") || "") &&
        region !== "all" &&
        (scope.region === "all" || region === scope.region)
      );
    }),
  );
}

function combine<T>(
  rows: Map<string, ResourceScan<T>>,
  errors: ResourceScan<T>["errors"] = [],
): ResourceScan<T> | undefined {
  if (!rows.size && !errors.length) return undefined;
  const scans = [...rows.values()];
  // A regional token failure must not be mistaken for invalid account credentials.
  // Only soften opt-in failures when another region proves this account works.
  const successfulAccounts = new Set(
    [...rows]
      .filter(([, scan]) => !scan.errors.length)
      .map(([path]) =>
        new URLSearchParams(path.split("?")[1]).get("accountId"),
      ),
  );
  const problems = [
    ...errors,
    ...[...rows].flatMap(([path, scan]) =>
      scan.errors.map((error) => ({
        ...error,
        accountId:
          new URLSearchParams(path.split("?")[1]).get("accountId") || undefined,
      })),
    ),
  ];
  const unavailable = problems.filter(
    (error) =>
      error.accountId &&
      successfulAccounts.has(error.accountId) &&
      optInRegionIds.has(error.region) &&
      /UnrecognizedClientException|OptInRequired|not.?subscribed/i.test(
        error.message,
      ),
  );
  return {
    items: scans.flatMap((scan) => scan.items),
    errors: problems.filter((error) => !unavailable.includes(error)),
    unavailable,
    scanned: scans.reduce((total, scan) => total + scan.scanned, 0),
    // Mixed cached/fresh results must not claim every region was refreshed now.
    at: scans.map((scan) => scan.at).sort()[0] || "",
  };
}

export function cachedResourceScan<T>(
  cache: ResourceCache,
  scope: ResourceScope,
  source: ScanSource<T>,
) {
  return combine(cachedRows(cache, scope, source));
}

export function requestPool(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    while (active < concurrency && queue.length) {
      active++;
      queue.shift()!();
    }
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        void Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}

/** Publish each account/region as it finishes, sharing requests across scopes. */
export async function loadResourceScan<T>(
  cache: ResourceCache,
  scope: ResourceScope,
  source: ScanSource<T>,
  request: ReadApi,
  update: (data: ResourceScan<T> | undefined, loading: boolean) => void,
  force = false,
) {
  const rows = cachedRows(cache, scope, source);
  const errors: ResourceScan<T>["errors"] = [];
  const schedule = requestPool(4);
  const publish = (loading = true) => update(combine(rows, errors), loading);
  publish();

  async function loadRegion(account: Account, region: string) {
    const path = source.path(account.id, region);
    try {
      const scan = await cache.load(
        path,
        () =>
          schedule(async () => {
            try {
              return source.normalize(
                await request<ResourceScan<T>>(refreshPath(path, force)),
                account,
                region,
              );
            } catch (error) {
              // A lost connection is a panel-wide problem, not an empty AWS region.
              // Reject it so the cache retains the last successful snapshot.
              if (error instanceof Error && isConnectionError(error))
                throw error;
              return {
                items: [],
                scanned: 0,
                at: new Date().toISOString(),
                errors: [
                  {
                    account: account.name,
                    accountId: account.id,
                    region,
                    message:
                      error instanceof Error ? error.message : "资源查询失败",
                    kind: error instanceof ApiError ? error.kind : undefined,
                  },
                ],
              };
            }
          }),
        force,
        AUTO_REFRESH_MS,
      );
      rows.set(path, scan);
    } catch (error) {
      errors.push({
        account: account.name,
        region,
        message: error instanceof Error ? error.message : "资源查询失败",
        kind: error instanceof ApiError ? error.kind : undefined,
      });
    }
    publish();
  }

  await Promise.all(
    scopeAccounts(scope).map(async (account) => {
      if (scope.region !== "all") {
        await loadRegion(account, scope.region);
        return;
      }
      // The configured region is useful immediately; discovery must not block it.
      const preferred = loadRegion(account, account.region);
      let regions: Region[] = [];
      try {
        const result = await cache.load(
          regionPath(account.id),
          () =>
            schedule(() =>
              request<{ items: Region[] }>(
                refreshPath(regionPath(account.id), force),
              ),
            ),
          force,
          15 * 60_000,
        );
        regions = result.items;
      } catch (error) {
        errors.push({
          account: account.name,
          region: account.region,
          kind: error instanceof ApiError ? error.kind : undefined,
          message:
            "区域列表查询失败：" +
            (error instanceof Error ? error.message : "请求失败"),
        });
        publish();
      }
      const others = [...new Set(regions.map((region) => region.id))].filter(
        (region) => region !== account.region,
      );
      await Promise.all([
        preferred,
        ...others.map((region) => loadRegion(account, region)),
      ]);
    }),
  );
  publish(false);
}
