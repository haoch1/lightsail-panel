import { useState, type CSSProperties } from "react";
import type { TrafficData } from "../../../shared/types";
import { bytes } from "../../components/ui";
import { dailyTrafficChart } from "../../lib/daily-traffic";

const amount = (value: number | null) =>
  value === null ? "暂无数据" : bytes(value);

export default function DailyTrafficChart({
  daily,
  loading,
}: {
  daily: TrafficData["daily"];
  loading: boolean;
}) {
  const bars = dailyTrafficChart(daily);
  const [selected, setSelected] = useState<string | null>(null);
  const active = bars.find((day) => day.date === selected);
  return (
    <section
      className="daily-chart"
      aria-label="每日流量图表"
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement))
          setSelected(null);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setSelected(null);
      }}
    >
      <div className="daily-chart-heading">
        <h2>每日流量</h2>
        <span>入站 + 出站</span>
      </div>
      {bars.length ? (
        <div className="daily-chart-scroll">
          <div
            className="daily-bars"
            style={{ "--days": bars.length } as CSSProperties}
          >
            {bars.map((day, index) => (
              <button
                key={day.date}
                className="daily-bar"
                aria-label={`${day.date}，入站 ${amount(day.inbound)}，出站 ${amount(day.outbound)}，合计 ${amount(day.total)}`}
                tabIndex={
                  day.date === (active?.date ?? bars[bars.length - 1].date)
                    ? 0
                    : -1
                }
                data-active={active?.date === day.date || undefined}
                data-missing={day.total === null || undefined}
                onMouseEnter={() => setSelected(day.date)}
                onFocus={() => setSelected(day.date)}
                onClick={() => setSelected(day.date)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowLeft"
                      ? index - 1
                      : event.key === "ArrowRight"
                        ? index + 1
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? bars.length - 1
                            : null;
                  if (event.key === "Escape") setSelected(null);
                  if (next === null) return;
                  event.preventDefault();
                  const target = Math.max(0, Math.min(bars.length - 1, next));
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>("button")
                    [target]?.focus();
                }}
              >
                <span className="daily-bar-track" aria-hidden="true">
                  <span
                    className="daily-bar-fill"
                    style={{ height: `${day.percent}%` }}
                  />
                  {day.total === null && (
                    <span className="daily-bar-missing">—</span>
                  )}
                </span>
                <span className="daily-bar-date" aria-hidden="true">
                  {day.date.slice(5)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="daily-chart-empty" role="status">
          {loading ? "正在读取流量…" : "暂无流量数据"}
        </div>
      )}
      {active && (
        <div className="daily-chart-tooltip" aria-hidden="true">
          <strong>{active.date}</strong>
          <dl>
            <div>
              <dt>入站</dt>
              <dd>{amount(active.inbound)}</dd>
            </div>
            <div>
              <dt>出站</dt>
              <dd>{amount(active.outbound)}</dd>
            </div>
            <div>
              <dt>合计</dt>
              <dd>{amount(active.total)}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
