import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { TrafficData } from "../../../shared/types";
import { bytes } from "../../components/ui";
import { dailyTrafficChart } from "../../lib/daily-traffic";
import { chartTooltipPosition } from "../../lib/chart-tooltip";

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
  const chartRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useEffect(() => {
    const hide = () => setSelected(null);
    window.addEventListener("resize", hide);
    return () => window.removeEventListener("resize", hide);
  }, []);
  function select(date: string, x: number, y: number) {
    const chart = chartRef.current;
    if (!chart) return;
    setSelected(date);
    setPosition(
      chartTooltipPosition(
        { x, y },
        chart.getBoundingClientRect(),
        {
          width: tooltipRef.current?.offsetWidth ?? 190,
          height: tooltipRef.current?.offsetHeight ?? 124,
        },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }
  const active = bars.find((day) => day.date === selected);
  return (
    <section
      ref={chartRef}
      className="daily-chart"
      aria-label="每日流量图表"
      onPointerLeave={(event) => {
        if (
          !event.currentTarget.contains(document.activeElement) ||
          !document.activeElement?.matches(":focus-visible")
        )
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
        <div
          className="daily-chart-scroll"
          onScroll={(event) => {
            const focused =
              event.currentTarget.querySelector<HTMLButtonElement>(
                ".daily-bar:focus-visible",
              );
            if (!focused?.dataset.date) {
              setSelected(null);
              return;
            }
            const rect = focused.getBoundingClientRect();
            select(
              focused.dataset.date,
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );
          }}
        >
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
                data-date={day.date}
                data-missing={day.total === null || undefined}
                onPointerMove={(event) => {
                  if (event.pointerType !== "touch")
                    select(day.date, event.clientX, event.clientY);
                }}
                onFocus={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  select(
                    day.date,
                    rect.left + rect.width / 2,
                    rect.top + rect.height / 2,
                  );
                }}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  select(
                    day.date,
                    event.detail ? event.clientX : rect.left + rect.width / 2,
                    event.detail ? event.clientY : rect.top + rect.height / 2,
                  );
                }}
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
      <div
        ref={tooltipRef}
        className="daily-chart-tooltip"
        style={{
          ...(active ? position : { left: 8, top: 8 }),
          visibility: active ? "visible" : "hidden",
        }}
        aria-hidden="true"
      >
        <strong>{active?.date ?? "\u00a0"}</strong>
        <dl>
          <div>
            <dt>入站</dt>
            <dd>{amount(active?.inbound ?? null)}</dd>
          </div>
          <div>
            <dt>出站</dt>
            <dd>{amount(active?.outbound ?? null)}</dd>
          </div>
          <div>
            <dt>合计</dt>
            <dd>{amount(active?.total ?? null)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
