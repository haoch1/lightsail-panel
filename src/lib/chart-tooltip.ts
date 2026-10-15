type Bounds = { left: number; top: number; width: number; height: number };

export function chartTooltipPosition(
  anchor: { x: number; y: number },
  chart: Bounds,
  tooltip: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const gap = 12;
  const left = Math.max(chart.left, 0) + 8;
  const top = Math.max(chart.top, 0) + 8;
  const right = Math.min(chart.left + chart.width, viewport.width) - 8;
  const bottom = Math.min(chart.top + chart.height, viewport.height) - 8;
  const x =
    anchor.x + gap + tooltip.width <= right
      ? anchor.x + gap
      : anchor.x - gap - tooltip.width;
  const y =
    anchor.y - gap - tooltip.height >= top
      ? anchor.y - gap - tooltip.height
      : anchor.y + gap;
  return {
    left:
      Math.min(Math.max(x, left), Math.max(left, right - tooltip.width)) -
      chart.left,
    top:
      Math.min(Math.max(y, top), Math.max(top, bottom - tooltip.height)) -
      chart.top,
  };
}
