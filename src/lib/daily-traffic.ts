import type { TrafficData } from "../../shared/types";

export function dailyTrafficChart(daily: TrafficData["daily"]) {
  const valid = (value: number | null) =>
    value !== null && Number.isFinite(value) && value >= 0 ? value : null;
  const bars = daily
    .map((day) => {
      const inbound = valid(day.inbound);
      const outbound = valid(day.outbound);
      return {
        date: day.date,
        inbound,
        outbound,
        total:
          inbound === null || outbound === null ? null : inbound + outbound,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const maximum = Math.max(0, ...bars.map((day) => day.total ?? 0));
  return bars.map((day) => ({
    ...day,
    percent: maximum && day.total !== null ? (day.total / maximum) * 100 : 0,
  }));
}
