import type { InstanceUsage } from "../../hooks/useInstanceUsage";
import { bundlePrice } from "../../lib/bundle";
import { bytes } from "../../lib/format";
import TrafficProgress from "../../components/TrafficProgress";

export function InstanceRate({ usage }: { usage?: InstanceUsage }) {
  return (
    <div className="instance-price">
      {usage?.price === undefined
        ? "…"
        : usage.price === null
          ? "—"
          : bundlePrice({ id: "", name: "", price: usage.price })}
    </div>
  );
}
export function MonthlyTraffic({ usage }: { usage?: InstanceUsage }) {
  return (
    <span
      title={
        usage?.traffic === undefined || usage?.traffic === null
          ? undefined
          : `上行：${usage.outbound == null ? "—" : bytes(usage.outbound)}\n下行：${usage.inbound == null ? "—" : bytes(usage.inbound)}`
      }
    >
      <TrafficProgress usage={usage} compact />
    </span>
  );
}
