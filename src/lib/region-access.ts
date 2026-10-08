import { optInRegionIds, regionLabel } from "../../shared/regions.ts";

export function isRegionalAccessError(region: string, message: string) {
  return (
    /OptInRequired|not.?subscribed/i.test(message) ||
    (optInRegionIds.has(region) && /UnrecognizedClientException/i.test(message))
  );
}

export function creationRegionError(region: string, message: string) {
  return isRegionalAccessError(region, message)
    ? `无法访问 ${regionLabel(region)}，暂时不能在此区域创建实例。请检查该区域是否已在 AWS 启用，以及账户的区域访问权限。`
    : message;
}
