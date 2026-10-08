import { error, paginate } from "./shared.mjs";
import { compareImages } from "../../shared/images.ts";

export async function regions(
  gateway,
  account,
  service = "lightsail",
  endpointRegion = account.region,
) {
  if (service !== "lightsail") throw error("此面板仅支持 Lightsail");
  const cacheKey = `${account.id}:${endpointRegion}`;
  const cached = gateway.regionCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.regions;
  const result = await gateway.send(
    account,
    "lightsail",
    endpointRegion,
    "GetRegions",
    { includeAvailabilityZones: true },
  );
  const regions = (result.regions || [])
    .map((x) => ({
      id: x.name,
      name: x.displayName || x.name,
      zones: (x.availabilityZones || [])
        .filter((z) => !z.state || z.state === "available")
        .map((z) => z.zoneName),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  gateway.regionCache.set(cacheKey, {
    regions,
    expires: Date.now() + 15 * 60000,
  });
  return regions;
}

export async function catalog(gateway, accountId, service, region) {
  if (service !== "lightsail") throw error("此面板仅支持 Lightsail");
  const account = gateway.store.account(accountId),
    warnings = [];
  const [images, types, regions] = await Promise.all([
    paginate(
      (p) =>
        gateway.send(account, service, region, "GetBlueprints", {
          ...p,
          includeInactive: false,
        }),
      "blueprints",
      "nextPageToken",
      "pageToken",
    ),
    paginate(
      (p) =>
        gateway.send(account, service, region, "GetBundles", {
          ...p,
          includeInactive: false,
        }),
      "bundles",
      "nextPageToken",
      "pageToken",
    ),
    gateway.regions(account, service, region),
  ]);
  return {
    images: images
      .filter(
        (x) =>
          x.isActive &&
          x.appCategory !== "LfR" &&
          x.type === "os" &&
          x.platform === "LINUX_UNIX" &&
          /^(?:debian|ubuntu|centos)(?:[ _-]|\d|$)/i.test(
            x.blueprintId || x.name || "",
          ),
      )
      .map((x) => ({
        id: x.blueprintId,
        name: x.name,
        platform: x.platform,
        type: x.type,
        version: x.version,
        description: x.description,
        minPower: x.minPower,
      }))
      .sort(compareImages),
    types: types
      .filter((x) => x.isActive && x.supportedPlatforms?.includes("LINUX_UNIX"))
      .map((x) => ({
        id: x.bundleId,
        name:
          x.cpuCount +
          " vCPU / " +
          x.ramSizeInGb +
          " GB / " +
          x.diskSizeInGb +
          " GB SSD · $" +
          x.price +
          "/月 · " +
          (x.publicIpv4AddressCount === 0 ? "仅 IPv6" : "含公网 IPv4") +
          " · " +
          x.transferPerMonthInGb +
          " GB 流量",
        price: x.price,
        platforms: x.supportedPlatforms,
        power: x.power,
        ipv4: x.publicIpv4AddressCount !== 0,
        cpu: x.cpuCount,
        memory: x.ramSizeInGb,
        disk: x.diskSizeInGb,
        transfer: x.transferPerMonthInGb,
      })),
    zones: regions.find((r) => r.id === region)?.zones || [],
    warnings,
  };
}
