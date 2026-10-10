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
  // Hourly history stays below 744 points per request; the current hour uses
  // native five-minute metrics, with disjoint windows to avoid double counting.
  const hour = new Date(Math.floor(window.end.getTime() / 3600000) * 3600000);
  const firstHour = new Date(
    Math.ceil(window.start.getTime() / 3600000) * 3600000,
  );
  const windows = [
    {
      start: window.start,
      end: new Date(Math.min(firstHour.getTime(), hour.getTime())),
      period: 300,
    },
    { start: firstHour, end: hour, period: 3600 },
    {
      start: new Date(Math.max(window.start.getTime(), hour.getTime())),
      end: window.end,
      period: 300,
    },
  ].filter((w) => w.start < w.end);
  const warnings = [];
  const series = await Promise.all(
    ["NetworkIn", "NetworkOut"].map(async (metricName) => {
      const results = await Promise.allSettled(
        windows.map((w) =>
          gateway.send(
            account,
            "lightsail",
            t.region,
            "GetInstanceMetricData",
            {
              instanceName: t.id,
              metricName,
              startTime: w.start,
              endTime: w.end,
              period: w.period,
              statistics: ["Sum"],
              unit: "Bytes",
            },
          ),
        ),
      );
      const points = [];
      results.forEach((result, index) => {
        if (result.status === "rejected")
          warnings.push(
            (metricName === "NetworkIn" ? "入站查询失败: " : "出站查询失败: ") +
              scrubError(result.reason),
          );
        else {
          const w = windows[index];
          points.push(
            ...(result.value.metricData || []).filter((p) => {
              const at = new Date(p.timestamp);
              return at >= w.start && at < w.end;
            }),
          );
        }
      });
      return points;
    }),
  );
  return {
    ...aggregateTraffic(series, window),
    warnings,
    at: now.toISOString(),
  };
}
