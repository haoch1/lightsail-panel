import type { InstanceUsage } from "../../hooks/useInstanceUsage";
import { bundlePrice } from "../../lib/bundle";
import { bytes } from "../../lib/format";
import TrafficProgress from "../../components/TrafficProgress";
import { when } from "../../components/ui";
import { LoadingRegion, Skeleton } from "../../components/ui/Skeleton";

export function InstanceRate({ usage }: { usage?: InstanceUsage }) {
  return (
    <div className="instance-price">
      {usage?.price === undefined && !usage?.priceError ? (
        <LoadingRegion inline label="正在读取套餐价格">
          <Skeleton className="skeleton-value" />
        </LoadingRegion>
      ) : usage?.price == null ? (
        "—"
      ) : (
        bundlePrice({ id: "", name: "", price: usage.price })
      )}
    </div>
  );
}
export function MonthlyTraffic({ usage }: { usage?: InstanceUsage }) {
  return (
    <span
      title={
        usage?.traffic === undefined || usage?.traffic === null
          ? undefined
          : `上行：${usage.outbound == null ? "—" : bytes(usage.outbound)}\n下行：${usage.inbound == null ? "—" : bytes(usage.inbound)}${usage.trafficAt ? `\n流量更新：${when(usage.trafficAt)}` : ""}${usage.trafficError ? `\n${usage.trafficError}` : ""}`
      }
    >
      <TrafficProgress usage={usage} compact />
    </span>
  );
}
