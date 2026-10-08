export type ChartRow = {
  at: string;
  [key: string]: string | number | undefined;
};
export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  dash?: string;
  width?: number;
};
export function chartExtent(
  data: ChartRow[],
  series: ChartSeries[],
  domain?: [number, number],
) {
  if (domain) return domain;
  const values = data.flatMap((row) =>
    series.flatMap((s) => {
      const v = row[s.key];
      return typeof v === "number" && Number.isFinite(v) ? [v] : [];
    }),
  );
  const low = Math.min(0, ...values),
    high = Math.max(0, ...values);
  const span = high - low || 1;
  return [low < 0 ? low - span * 0.06 : 0, high + span * 0.1] as [
    number,
    number,
  ];
}
export function linePath(
  points: Array<{ x: number; y: number | null }>,
  step = false,
) {
  let open = false;
  return points
    .map((p) => {
      if (p.y === null) {
        open = false;
        return "";
      }
      const value = `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
      const segment = !open
        ? `M${value}`
        : step
          ? `H${p.x.toFixed(2)} V${p.y.toFixed(2)}`
          : `L${value}`;
      open = true;
      return segment;
    })
    .join(" ");
}
