import type { ResourceScan } from "../../shared/types";
import { regionLabel } from "../../shared/regions.ts";
import { isConnectionError } from "./api-error.ts";
import { isRegionalAccessError } from "./region-access.ts";

export function scanNotices(errors: ResourceScan<unknown>["errors"] = []) {
  const notices = new Map<string, { key: string; message: string }>();
  for (const error of errors) {
    if (isRegionalAccessError(error.region, error.message)) continue;
    const connection = isConnectionError(error);
    const key = connection
      ? "panel-connection"
      : JSON.stringify([
          error.accountId || error.account,
          error.region,
          error.message,
        ]);
    notices.set(key, {
      key,
      message: connection
        ? "无法连接面板服务，已保留上次查询结果。请检查网络后点击刷新。"
        : `${error.account} · ${regionLabel(error.region)}：${error.message}`,
    });
  }
  return [...notices.values()];
}
