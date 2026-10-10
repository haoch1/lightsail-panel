export function trafficRange(range, now = new Date(), utcOffsetMinutes = 0) {
  const offset = utcOffsetMinutes;
  const localNow = new Date(now.getTime() + offset * 60000);
  const end = new Date(Math.floor(now.getTime() / 300000) * 300000);
  // Calendar days include today, so every range shares the same daily buckets.
  const day =
    range === "month"
      ? 1
      : localNow.getUTCDate() - ({ "7d": 6, "30d": 29 }[range] || 0);
  const start = new Date(
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), day) -
      offset * 60000,
  );
  return { start, end, utcOffsetMinutes: offset };
}
export function aggregateTraffic(series, { start, end, utcOffsetMinutes = 0 }) {
  const daily = new Map();
  const totals = { inbound: null, outbound: null, combined: null };
  const samples = { inbound: 0, outbound: 0 };
  ["inbound", "outbound"].forEach((field, index) => {
    const seen = new Set();
    for (const point of series[index] || []) {
      const at = new Date(point.timestamp);
      if (
        !Number.isFinite(point.sum) ||
        point.sum < 0 ||
        !Number.isFinite(at.getTime()) ||
        at < start ||
        at >= end ||
        seen.has(at.getTime())
      )
        continue;
      seen.add(at.getTime());
      totals[field] = (totals[field] ?? 0) + point.sum;
      samples[field]++;
      const date = new Date(at.getTime() + utcOffsetMinutes * 60000)
        .toISOString()
        .slice(0, 10);
      const row = daily.get(date) || { date, inbound: null, outbound: null };
      row[field] = (row[field] ?? 0) + point.sum;
      daily.set(date, row);
    }
  });
  if (totals.inbound !== null && totals.outbound !== null)
    totals.combined = totals.inbound + totals.outbound;
  return {
    utcOffsetMinutes,
    start: start.toISOString(),
    end: end.toISOString(),
    totals,
    samples,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    period: 300,
  };
}
