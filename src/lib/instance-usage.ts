import type { Catalog, Instance } from "../../shared/types";

export const instanceKey = (i: Instance) =>
  `${i.accountId}:${i.region}:${i.id}`;
export const pricePath = (i: Instance) =>
  "/bundles?" +
  new URLSearchParams({
    accountId: i.accountId,
    region: i.region,
    service: "lightsail",
  });
export const monthlyTrafficPath = (i: Instance, utcOffsetMinutes: number) =>
  "/traffic?" +
  new URLSearchParams({
    accountId: i.accountId,
    region: i.region,
    service: "lightsail",
    id: i.id,
    range: "month",
    utcOffsetMinutes: String(utcOffsetMinutes),
  });
export const instanceBundle = (catalog: Pick<Catalog, "types">, i: Instance) =>
  catalog.types.find((bundle) => bundle.id === i.instanceType);
