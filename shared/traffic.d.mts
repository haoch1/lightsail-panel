export function trafficRange(
  range: string,
  now?: Date,
  utcOffsetMinutes?: number,
): { start: Date; end: Date; utcOffsetMinutes: number };
export function aggregateTraffic(
  series: { timestamp?: Date | string; sum?: number }[][],
  window: { start: Date; end: Date; utcOffsetMinutes?: number },
): {
  utcOffsetMinutes: number;
  start: string;
  end: string;
  period: number;
  totals: {
    inbound: number | null;
    outbound: number | null;
    combined: number | null;
  };
  samples: { inbound: number; outbound: number };
  daily: { date: string; inbound: number | null; outbound: number | null }[];
};
