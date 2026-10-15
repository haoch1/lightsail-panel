import { useState } from "react";
import type { Instance, TrafficData } from "../../../shared/types";
import { useApi } from "../../app/context";
import {
  TableLoading,
  Empty,
  ErrorBox,
  RefreshButton,
  bytes,
  targetOf,
  when,
} from "../../components/ui";
import { query } from "../../lib/api";
import DailyTrafficChart from "./DailyTrafficChart";

const size = (n: number | null) => (n === null ? "—" : bytes(n));
function TrafficTotal({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const [amount, unit] = size(value).split(" ");
  return (
    <div>
      <span>{label}</span>
      <strong>
        <span className="traffic-amount">{amount}</span>
        <span className="traffic-unit">{unit || "\u00a0"}</span>
      </strong>
    </div>
  );
}
export default function Traffic({ instance }: { instance?: Instance }) {
  const [range, setRange] = useState("month");
  const { data, error, loading, previousData, refresh } = useApi<TrafficData>(
    instance
      ? "/traffic?" +
          query({
            ...targetOf(instance),
            range,
            utcOffsetMinutes: -new Date().getTimezoneOffset(),
          })
      : null,
    {
      retainKey: instance ? "traffic:" + query(targetOf(instance)) : undefined,
    },
  );
  const initialLoading = !instance || (loading && !data);
  const daily = data?.daily
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  const offset = data?.utcOffsetMinutes ?? -new Date().getTimezoneOffset();
  const displayTime = (iso: string) =>
    new Date(new Date(iso).getTime() + offset * 60000)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
  const timezone = offset
    ? `UTC${offset < 0 ? "−" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`
    : "UTC";
  const startTime = data ? displayTime(data.start) : "";
  const endTime = data ? displayTime(data.end) : "";
  const rangeEnd =
    startTime.slice(0, 10) === endTime.slice(0, 10)
      ? endTime.slice(11)
      : endTime;
  return (
    <div className="traffic-content" aria-busy={initialLoading || loading}>
      <div className="toolbar">
        <div className="periods">
          {Object.entries({
            month: "本月",
            "7d": "近 7 天",
            "30d": "近 30 天",
          }).map(([key, text]) => (
            <button
              key={key}
              className={"button " + (key === range ? "primary" : "")}
              aria-pressed={key === range}
              disabled={!instance}
              onClick={() => setRange(key)}
            >
              {text}
            </button>
          ))}
        </div>
        <RefreshButton loading={initialLoading || loading} onClick={refresh} />
      </div>
      {error && <ErrorBox message={error} retry={refresh} />}
      {data?.warnings.map((w, n) => (
        <ErrorBox key={n} message={w} retry={refresh} />
      ))}
      <section className="traffic-overview" aria-label="流量汇总">
        <TrafficTotal label="入站流量" value={data?.totals.inbound ?? null} />
        <TrafficTotal label="出站流量" value={data?.totals.outbound ?? null} />
        <TrafficTotal label="合计流量" value={data?.totals.combined ?? null} />
      </section>
      <div className="traffic-range">
        <span title={data ? `上次查询：${when(data.at)}` : undefined}>
          {data ? `${startTime} → ${rangeEnd}（${timezone}）` : "—"}
        </span>
        <span className="sr-only" role="status">
          {previousData ? "正在更新查询结果…" : ""}
        </span>
      </div>
      <DailyTrafficChart daily={data?.daily ?? []} loading={initialLoading} />
      <details className="traffic-daily" open>
        <summary>每日明细</summary>
        <div className="table-wrap">
          <table className="traffic-daily-table">
            <thead>
              <tr>
                <th>日期</th>
                <th className="amount-column">入站</th>
                <th className="amount-column">出站</th>
                <th className="amount-column">合计</th>
              </tr>
            </thead>
            <tbody>
              {initialLoading && (
                <TableLoading columns={["日期", "入站", "出站", "合计"]} />
              )}
              {daily?.map((d) => (
                <tr className="resource-row" key={d.date}>
                  <td data-label="日期">{d.date}</td>
                  <td data-label="入站" className="amount-column mono">
                    {size(d.inbound)}
                  </td>
                  <td data-label="出站" className="amount-column mono">
                    {size(d.outbound)}
                  </td>
                  <td data-label="合计" className="amount-column mono">
                    {size(
                      d.inbound !== null && d.outbound !== null
                        ? d.inbound + d.outbound
                        : null,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!initialLoading &&
            !loading &&
            !error &&
            data &&
            !data.daily.length && (
              <Empty
                title="此时间范围暂无流量数据"
                description="刚创建、已停止的实例可能没有指标；缺失数据不会补成零。"
              />
            )}
        </div>
      </details>
      <p className="traffic-note">
        入站与出站合计，非 AWS 计费流量；指标可能延迟。
      </p>
    </div>
  );
}
