/** Resource reads refresh at most on five-minute boundaries unless explicitly requested. */
export const AUTO_REFRESH_MS = 5 * 60_000;
/** Next wall-clock boundary: :00, :05, :10, and so on. */
export const nextRefreshAt = (now: number, interval = AUTO_REFRESH_MS) =>
  (Math.floor(now / interval) + 1) * interval;
export const isResourcePath = (path: string) =>
  /^\/(?:accounts|regions|instances|catalog|static-ips|traffic-limit|traffic|ports)(?:\?|$)/.test(
    path,
  );
export const refreshPath = (path: string, force: boolean) =>
  force && isResourcePath(path) && !path.startsWith("/accounts")
    ? path + (path.includes("?") ? "&" : "?") + "refresh=1"
    : path;
