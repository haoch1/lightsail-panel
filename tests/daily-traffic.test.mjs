import assert from "node:assert/strict";
import test from "node:test";
import { dailyTrafficChart } from "../src/lib/daily-traffic.ts";

test("daily chart orders dates chronologically without mutating descending detail data", () => {
  const daily = [
    { date: "2026-10-12", inbound: 20, outbound: 30 },
    { date: "2026-10-11", inbound: 10, outbound: 15 },
  ];
  const bars = dailyTrafficChart(daily);
  assert.deepEqual(
    bars.map((bar) => [bar.date, bar.total, bar.percent]),
    [
      ["2026-10-11", 25, 50],
      ["2026-10-12", 50, 100],
    ],
  );
  assert.equal(daily[0].date, "2026-10-12");
});

test("missing or invalid traffic stays unknown rather than becoming a zero or partial total", () => {
  const bars = dailyTrafficChart([
    { date: "2026-10-10", inbound: null, outbound: 10 },
    { date: "2026-10-11", inbound: 10, outbound: NaN },
    { date: "2026-10-12", inbound: -1, outbound: 20 },
  ]);
  assert.ok(bars.every((bar) => bar.total === null && bar.percent === 0));
  assert.equal(bars[0].outbound, 10);
});

test("empty and zero traffic produce finite chart values", () => {
  assert.deepEqual(dailyTrafficChart([]), []);
  assert.deepEqual(
    dailyTrafficChart([{ date: "2026-10-12", inbound: 0, outbound: 0 }]),
    [{ date: "2026-10-12", inbound: 0, outbound: 0, total: 0, percent: 0 }],
  );
});
