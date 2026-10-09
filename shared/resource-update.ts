export type ResourceUpdate = {
  accountId: string;
  region: string;
  resources: string[];
};
export function matchesUpdate(path: string, update: ResourceUpdate) {
  path = path.replace(/^\/api(?=\/)/, "");
  if (!update.resources.some((resource) => path.startsWith(`/${resource}?`)))
    return false;
  const query = new URLSearchParams(path.split("?")[1]);
  return (
    (!query.get("accountId") ||
      query.get("accountId") === "all" ||
      query.get("accountId") === update.accountId) &&
    (!query.get("region") ||
      query.get("region") === "all" ||
      query.get("region") === update.region)
  );
}
export function mutationUpdate(
  path: string,
  body: unknown,
): ResourceUpdate | undefined {
  if (!body || typeof body !== "object") return;
  const value = body as Record<string, unknown>;
  if (typeof value.accountId !== "string" || typeof value.region !== "string")
    return;
  const resources =
    path === "/ports"
      ? ["ports"]
      : path === "/launch"
        ? [
            "instances",
            ...(value.allocateStaticIp ? ["static-ips"] : []),
            ...(value.firewall ? ["ports"] : []),
          ]
        : path.startsWith("/instances/action")
          ? [
              "instances",
              ...(value.action === "rotate-ip" ? ["static-ips"] : []),
            ]
          : path === "/static-ips"
            ? [
                "static-ips",
                ...(["attach", "detach"].includes(String(value.action))
                  ? ["instances"]
                  : []),
              ]
            : [];
  return resources.length
    ? { accountId: value.accountId, region: value.region, resources }
    : undefined;
}
