import type { Catalog } from "../../shared/types";
import { whole } from "./format.ts";

type Bundle = Catalog["types"][number];
const monthlyUsd = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const compact = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 })
  .format;
export const memoryLabel = (gb: number) =>
  gb === 0.5 ? "512 MB" : `${compact(gb)} GB`;

// GetBundles has no family field. General-purpose IDs start with their size;
// memory- and compute-optimized IDs use m_ and c_ prefixes respectively.
export const isGeneralBundle = (bundle: Bundle) =>
  /^(?:nano|micro|small|medium|large|xlarge|\d+xlarge)(?:_ipv6)?(?:_\d+_\d+)?$/.test(
    bundle.id,
  );

export const bundlePrice = (bundle: Bundle) =>
  bundle.price === undefined ? "" : `${monthlyUsd.format(bundle.price)}/月`;

export function bundleSpecs(bundle: Bundle) {
  return bundle.memory === undefined || bundle.cpu === undefined
    ? bundle.name
    : `${memoryLabel(bundle.memory)} 内存 · ${whole(bundle.cpu)} vCPU`;
}

export function bundleDetails(bundle: Bundle) {
  return [
    ...(bundle.disk === undefined ? [] : [`${compact(bundle.disk)} GB SSD`]),
    ...(bundle.transfer === undefined
      ? []
      : [
          bundle.transfer >= 1024
            ? `${compact(bundle.transfer / 1024)} TB 流量/月`
            : `${compact(bundle.transfer)} GB 流量/月`,
        ]),
  ].join(" · ");
}

export const compactBundleLabel = (bundle: Bundle) =>
  [bundleSpecs(bundle), bundleDetails(bundle), bundlePrice(bundle)]
    .filter(Boolean)
    .join(" · ");

export function bundleLabel(bundle: Catalog["types"][number]) {
  if (
    bundle.cpu === undefined ||
    bundle.memory === undefined ||
    bundle.disk === undefined
  )
    return bundle.name;
  return [
    `${whole(bundle.cpu)} vCPU / ${memoryLabel(bundle.memory)} / ${compact(bundle.disk)} GB SSD`,
    ...(bundle.price === undefined ? [] : [bundlePrice(bundle)]),
    bundle.ipv4 === false ? "仅 IPv6" : "含公网 IPv4",
    ...(bundle.transfer === undefined
      ? []
      : [`${compact(bundle.transfer)} GB 流量`]),
  ].join(" · ");
}
