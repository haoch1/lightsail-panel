import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { chartDate } from "../../lib/format";
import type { ChartRow, ChartSeries } from "./geometry";
import { chartExtent, linePath } from "./geometry";

export default function TimeSeriesChart({
  data,
  series,
  formatValue,
  label,
  domain,
  dateMode = "time",
  step = false,
  area = false,
  summary,
  readout,
  tooltip,
  formatAxis = formatValue,
}: {
  data: ChartRow[];
  series: ChartSeries[];
  formatValue: (value: number) => string;
  label: string;
  domain?: [number, number];
  dateMode?: "date" | "time";
  step?: boolean;
  area?: boolean;
  summary?: string;
  readout?: (row: ChartRow, active: boolean) => ReactNode;
  tooltip?: (row: ChartRow) => ReactNode;
  formatAxis?: (value: number) => string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const clipId = useId().replace(/:/g, "");
  const [width, setWidth] = useState(500);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, Math.round(entry.contentRect.width))),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setActive(null), [data]);
  const [min, max] = chartExtent(data, series, domain);
  const left = width < 450 ? 66 : 76,
    right = width - 14,
    top = 14,
    bottom = 174;
  const first = Date.parse(data[0]?.at || ""),
    last = Date.parse(data.at(-1)?.at || "");
  const x = (index: number) =>
    data.length < 2 || first === last
      ? (left + right) / 2
      : left +
        ((Date.parse(data[index].at) - first) / (last - first)) *
          (right - left);
  const y = (value: number) =>
    bottom - ((value - min) / (max - min)) * (bottom - top);
  const current = data[active ?? data.length - 1];
  const tickCount = width < 450 ? (dateMode === "time" ? 2 : 3) : 5;
  const ticks = [
    ...new Set(
      Array.from({ length: Math.min(tickCount, data.length) }, (_, i) =>
        Math.round(
          (i * (data.length - 1)) /
            Math.max(1, Math.min(tickCount, data.length) - 1),
        ),
      ),
    ),
  ];
  function selectAt(clientX: number, bounds: DOMRect) {
    const local = ((clientX - bounds.left) * width) / bounds.width;
    let nearest = 0;
    for (let i = 1; i < data.length; i++)
      if (Math.abs(x(i) - local) < Math.abs(x(nearest) - local)) nearest = i;
    setActive(nearest);
  }
  return (
    <div className="time-series" ref={container}>
      <div className="chart-summary">
        <span>
          {summary ||
            (active === null
              ? "悬停查看详情 · 方向键切换"
              : chartDate(current?.at || "", dateMode, true))}
        </span>
        <span className="chart-readout" aria-live="polite">
          {current &&
            (readout
              ? readout(current, active !== null)
              : series.map((s) => (
                  <span key={s.key}>
                    <i style={{ background: s.color }} />
                    {s.label}
                    <strong>
                      {typeof current[s.key] === "number"
                        ? formatValue(current[s.key] as number)
                        : "—"}
                    </strong>
                  </span>
                )))}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} 206`}
        role="group"
        aria-label={label}
        tabIndex={0}
        onPointerMove={(e) =>
          selectAt(e.clientX, e.currentTarget.getBoundingClientRect())
        }
        onPointerLeave={() => {
          if (
            document.activeElement !== container.current?.querySelector("svg")
          )
            setActive(null);
        }}
        onClick={(e) =>
          selectAt(e.clientX, e.currentTarget.getBoundingClientRect())
        }
        onFocus={() => setActive(data.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (
            ["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(e.key)
          ) {
            e.preventDefault();
            setActive(
              e.key === "Escape"
                ? null
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? data.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          data.length - 1,
                          (active ?? data.length - 1) +
                            (e.key === "ArrowLeft" ? -1 : 1),
                        ),
                      ),
            );
          }
        }}
      >
        <title>{label}；方向键选择数据，Escape 清除选择</title>
        <defs>
          <clipPath id={clipId}>
            <rect x={left} y={top} width={right - left} height={bottom - top} />
          </clipPath>
          {area &&
            series.map((s) => (
              <linearGradient
                key={s.key}
                id={`${clipId}-${s.key}-area`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity={0.16} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.01} />
              </linearGradient>
            ))}
        </defs>
        {[0, 1, 2].map((i) => {
          const value = min + ((max - min) * i) / 2;
          return (
            <g key={i}>
              <line
                x1={left}
                x2={right}
                y1={y(value)}
                y2={y(value)}
                className="chart-gridline"
              />
              <text
                x={left - 10}
                y={y(value) + 4}
                textAnchor="end"
                className="chart-axis"
              >
                {formatAxis(value)}
              </text>
            </g>
          );
        })}
        <g clipPath={`url(#${clipId})`}>
          {series.map((s) => {
            const points = data.map((row, index) => ({
              x: x(index),
              y:
                typeof row[s.key] === "number" ? y(row[s.key] as number) : null,
            }));
            const path = linePath(points, step);
            return (
              <g key={s.key}>
                {area &&
                  points.length > 1 &&
                  points.every((p) => p.y !== null) && (
                    <path
                      d={`${path} L${right} ${y(0)} L${left} ${y(0)} Z`}
                      fill={`url(#${clipId}-${s.key}-area)`}
                    />
                  )}
                <path
                  d={path}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.width ?? 1.8}
                  strokeDasharray={s.dash}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {active !== null && current && (
            <>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={top}
                y2={bottom}
                className="chart-crosshair"
              />
              {series.map(
                (s) =>
                  typeof current[s.key] === "number" && (
                    <circle
                      key={s.key}
                      cx={x(active)}
                      cy={y(current[s.key] as number)}
                      r={3.5}
                      fill={s.color}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  ),
              )}
            </>
          )}
        </g>
        {ticks.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={197}
            textAnchor={
              index === 0
                ? "start"
                : index === data.length - 1
                  ? "end"
                  : "middle"
            }
            className="chart-axis"
          >
            {chartDate(data[index].at, dateMode)}
          </text>
        ))}
      </svg>
      {active !== null && current && tooltip && (
        <div
          className="chart-tooltip"
          role="tooltip"
          style={active > data.length / 2 ? { left: left + 12 } : { right: 14 }}
        >
          {tooltip(current)}
        </div>
      )}
      {!data.length && <p className="chart-footnote">此时间段没有可用数据</p>}
    </div>
  );
}
