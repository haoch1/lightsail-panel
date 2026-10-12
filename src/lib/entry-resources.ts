import type { Account } from "../../shared/types";

/** Map server snapshot keys to the request identities used by the browser. */
export function entryResources(
  entries: [string, unknown][] = [],
  accounts: Account[],
  utcOffsetMinutes: number,
): [string, unknown][] {
  return entries.flatMap((entry) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string"
    )
      return [];
    const [key, value] = entry;
    const [path, search] = key.split("?");
    const q = new URLSearchParams(search);
    const account = accounts.find((a) => a.id === q.get("accountId"));
    if (!account || !value || typeof value !== "object") return [];
    const params = new URLSearchParams({ accountId: account.id });
    let data = value;
    if (path === "/regions") params.set("service", "lightsail");
    else if (
      [
        "/instances",
        "/bundles",
        "/catalog",
        "/static-ips",
        "/ports",
        "/traffic",
      ].includes(path)
    ) {
      const region = q.get("region");
      if (!region || region === "all") return [];
      params.set("region", region);
      if (path !== "/static-ips") params.set("service", "lightsail");
      if (path === "/ports" || path === "/traffic") {
        if (!q.get("id")) return [];
        params.set("id", q.get("id")!);
      }
      if (path === "/traffic") {
        if (Number(q.get("utcOffsetMinutes")) !== utcOffsetMinutes) return [];
        params.set("range", q.get("range") || "month");
        params.set("utcOffsetMinutes", String(utcOffsetMinutes));
      }
      if (path === "/static-ips") {
        const scan = value as { items?: object[]; at?: string };
        if (!Array.isArray(scan.items)) return [];
        data = {
          ...scan,
          items: scan.items.map((ip) => ({
            ...ip,
            accountId: account.id,
            accountName: account.name,
            region,
          })),
          errors: [],
          scanned: 1,
        };
      }
    } else return [];
    return [[path + "?" + params, data] as [string, unknown]];
  });
}
