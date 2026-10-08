import type { ScopedStaticIp } from "../../shared/types";
import type { ScanSource } from "./resource-scan.ts";

export const staticIpSource: ScanSource<ScopedStaticIp> = {
  prefix: "/static-ips?",
  path: (accountId, region) =>
    "/static-ips?" + new URLSearchParams({ accountId, region }),
  normalize: (data, account, region) => ({
    ...data,
    items: data.items.map((ip) => ({
      ...ip,
      accountId: account.id,
      accountName: account.name,
      region,
    })),
    errors: data.errors || [],
    scanned: 1,
    at: data.at || new Date().toISOString(),
  }),
};
