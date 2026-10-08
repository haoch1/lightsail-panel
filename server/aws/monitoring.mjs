import { aggregateTraffic, trafficRange } from "../../shared/traffic.mjs";
import { scrubError } from "./shared.mjs";

export async function traffic(
  gateway,
  t,
  range,
  now = new Date(),
  utcOffsetMinutes = 0,
) {
  const account = gateway.store.account(t.accountId);
  const window = trafficRange(range, now, utcOffsetMinutes);
  if (window.start >= window.end)
    return {
      ...aggregateTraffic([[], []], window),
      warnings: [],
      at: now.toISOString(),
    };
  const rows = await Promise.allSettled(
    ["NetworkIn", "NetworkOut"].map(async (metricName) => {
      const r = await gateway.send(
        account,
        "lightsail",
        t.region,
        "GetInstanceMetricData",
        {
          instanceName: t.id,
          metricName,
          startTime: window.start,
          endTime: window.end,
          period: 3600,
          statistics: ["Sum"],
          unit: "Bytes",
        },
      );
      return r.metricData || [];
    }),
  );
  return {
    ...aggregateTraffic(
      rows.map((r) => (r.status === "fulfilled" ? r.value : [])),
      window,
    ),
    warnings: rows.flatMap((r, i) =>
      r.status === "rejected"
        ? [(i === 0 ? "入站" : "出站") + "查询失败：" + scrubError(r.reason)]
        : [],
    ),
    at: now.toISOString(),
  };
}
