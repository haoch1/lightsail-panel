/** Resource reads refresh at most once per five minutes unless explicitly requested. */
export const AUTO_REFRESH_MS = 5 * 60_000;
export const isResourcePath = (path: string) =>
  /^\/(?:accounts|regions|instances|catalog|static-ips|traffic|ports)(?:\?|$)/.test(
    path,
  );
export const refreshPath = (path: string, force: boolean) =>
  force && isResourcePath(path) && !path.startsWith("/accounts")
    ? path + (path.includes("?") ? "&" : "?") + "refresh=1"
    : path;
