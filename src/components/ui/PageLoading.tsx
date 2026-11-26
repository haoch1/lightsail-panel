import type { ReactNode } from "react";
import {
  ChartSkeleton,
  InventorySkeleton,
  LoadingRegion,
  Skeleton,
} from "./Skeleton";
import { TableLoading } from "./TableLoading";

const tableColumns: Record<string, string[]> = {
  "/instances": [
    "",
    "实例",
    "状态",
    "规格 / 价格",
    "本月流量",
    "网络",
    "账户 / 区域",
    "操作",
  ],
  "/ips": ["静态 IP", "地址", "绑定实例", "账户 / 区域", "操作"],
  "/firewall": ["协议", "端口", "来源", "操作"],
  "/audit": ["时间", "操作", "目标资源", "结果", "详情"],
};

export function FormSkeleton() {
  return (
    <div className="form-grid" aria-hidden="true">
      {[0, 1, 2, 3].map((field) => (
        <div className="skeleton-form-field" key={field}>
          <Skeleton className="skeleton-meta" />
          <Skeleton className="skeleton-input" />
        </div>
      ))}
    </div>
  );
}

export default function PageLoading({
  path,
  title,
  icon,
}: {
  path: string;
  title: string;
  icon: ReactNode;
}) {
  const columns = tableColumns[path];
  return (
    <LoadingRegion label={"正在加载" + title} className="page-skeleton">
      <div className="page-heading">
        <h1>
          {icon}
          {title}
        </h1>
        <Skeleton className="skeleton-button" />
      </div>
      {columns ? (
        <>
          {path !== "/audit" && (
            <div className="skeleton-page-toolbar" aria-hidden="true">
              <Skeleton />
              <Skeleton />
            </div>
          )}
          <div
            className={
              "table-wrap" +
              (path === "/instances" ? " loading-desktop-inventory" : "")
            }
          >
            <table className="responsive-table">
              <thead>
                <tr>
                  {columns.map((name) => (
                    <th key={name}>{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2].map((row) => (
                  <TableLoading key={row} columns={columns} />
                ))}
              </tbody>
            </table>
          </div>
          {path === "/instances" && (
            <div className="loading-mobile-inventory">
              <InventorySkeleton />
              <InventorySkeleton />
            </div>
          )}
        </>
      ) : path === "/traffic" ? (
        <>
          <div className="traffic-overview" aria-hidden="true">
            {[0, 1, 2].map((column) => (
              <div key={column}>
                <Skeleton className="skeleton-meta" />
                <strong>
                  <Skeleton />
                </strong>
              </div>
            ))}
          </div>
          <div className="daily-chart">
            <ChartSkeleton />
          </div>
        </>
      ) : (
        <>
          <section className="form-panel">
            <FormSkeleton />
          </section>
          <section className="form-panel">
            <FormSkeleton />
          </section>
        </>
      )}
    </LoadingRegion>
  );
}
