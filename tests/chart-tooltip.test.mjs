import assert from "node:assert/strict";
import test from "node:test";
import { chartTooltipPosition } from "../src/lib/chart-tooltip.ts";

const chart = { left: 100, top: 200, width: 800, height: 300 };
const tooltip = { width: 190, height: 124 };
const viewport = { width: 1200, height: 800 };

test("chart tooltip follows the pointer in both directions", () => {
  const first = chartTooltipPosition(
    { x: 300, y: 400 },
    chart,
    tooltip,
    viewport,
  );
  const moved = chartTooltipPosition(
    { x: 350, y: 420 },
    chart,
    tooltip,
    viewport,
  );
  assert.equal(moved.left - first.left, 50);
  assert.equal(moved.top - first.top, 20);
});

test("chart tooltip flips at edges and stays inside the visible chart", () => {
  for (const anchor of [
    { x: 110, y: 210 },
    { x: 890, y: 490 },
  ]) {
    const pos = chartTooltipPosition(anchor, chart, tooltip, viewport);
    assert.ok(pos.left >= 8 && pos.left + tooltip.width <= chart.width - 8);
    assert.ok(pos.top >= 8 && pos.top + tooltip.height <= chart.height - 8);
  }
  const narrow = chartTooltipPosition(
    { x: 290, y: 620 },
    { left: 16, top: 540, width: 288, height: 300 },
    tooltip,
    { width: 320, height: 720 },
  );
  assert.ok(narrow.left >= 8 && narrow.left + tooltip.width <= 280);
  assert.ok(narrow.top >= 8 && narrow.top + tooltip.height <= 172);
});
