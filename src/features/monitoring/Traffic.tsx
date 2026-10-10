import { useState } from "react";
import type { Instance, TrafficData } from "../../../shared/types";
import { useApi } from "../../app/context";
import {
  Busy,
  Empty,
  ErrorBox,
  RefreshButton,
  bytes,
  targetOf,
  when,
} from "../../components/ui";
import { query } from "../../lib/api";

const size = (n: number | null) => (n === null ? "—" : bytes(n));
export default function Traffic({ instance }: { instance: Instance }) {
  const [range, setRange] = useState("month");
  const { data, error, loading, previousData, refresh } = useApi<TrafficData>(
    "/traffic?" +
      query({
        ...targetOf(instance),
        range,
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
      }),
    { retainKey: "traffic:" + query(targetOf(instance)) },
  );
  const offset = data?.utcOffsetMinutes || 0;
  const displayTime = (iso: string) =>
    new Date(new Date(iso).getTime() + offset * 60000)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
  const timezone = offset
    ? `UTC${offset < 0 ? "−" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`
    : "UTC";
  return (
    <>
      <div className="toolbar">
        <div className="periods">
          {Object.entries({
            month: "本月",
            today: "今日",
            "7d": "近 7 天",
            "30d": "近 30 天",
          }).map(([key, text]) => (
            <button
              key={key}
              className={"button " + (key === range ? "primary" : "")}
              aria-pressed={key === range}
              onClick={() => setRange(key)}
            >
              {text}
            </button>
          ))}
        </div>
        <RefreshButton loading={loading} onClick={refresh} />
      </div>
      {error && <ErrorBox message={error} retry={refresh} />}
      {data?.warnings.map((w, n) => (
        <ErrorBox key={n} message={w} retry={refresh} />
      ))}
      {loading && !data ? (
        <Busy text="查询实例流量…" />
      ) : (
        data && (
          <>
            <section className="traffic-overview" aria-label="流量汇总">
              <div>
                <span>入站流量</span>
                <strong>{size(data.totals.inbound)}</strong>
              </div>
              <div>
                <span>出站流量</span>
                <strong>{size(data.totals.outbound)}</strong>
              </div>
              <div>
                <span>合计流量</span>
                <strong>{size(data.totals.combined)}</strong>
              </div>
            </section>
            <div className="traffic-range">
              {displayTime(data.start)} → {displayTime(data.end)}（{timezone}）
              {previousData && <span role="status">当前显示上次查询结果</span>}
            </div>
            <section className="panel traffic-daily">
              <div className="section-heading">
                <h2>按日流量</h2>
                <span className="muted">{timezone} 日期</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th className="amount-column">入站</th>
                      <th className="amount-column">出站</th>
                      <th className="amount-column">合计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((d) => (
                      <tr key={d.date}>
                        <td>{d.date}</td>
                        <td className="amount-column mono">
                          {size(d.inbound)}
                        </td>
                        <td className="amount-column mono">
                          {size(d.outbound)}
                        </td>
                        <td className="amount-column mono">
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
                {!data.daily.length && (
                  <Empty
                    title="此时间范围暂无流量数据"
                    description="刚创建、已停止的实例可能没有指标；缺失数据不会补成零。"
                  />
                )}
              </div>
            </section>
            <p className="traffic-note">
              统计全部网卡的入站、出站字节数。流量使用量不等同于 AWS
              计费流量或套餐剩余额度；近期指标可能延迟。
            </p>
            <div className="table-footer">
              <span>上次查询 {when(data.at)}</span>
            </div>
          </>
        )
      )}
    </>
  );
}
