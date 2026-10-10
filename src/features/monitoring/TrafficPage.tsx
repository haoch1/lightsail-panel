import { useInstances } from "../../hooks/useInstances";
import ScanNotices from "../../components/ScanNotices";
import { regionLabel } from "../../../shared/regions";
import { ArrowDownUp } from "lucide-react";
import { useState } from "react";
import type { Scan } from "../../../shared/types";
import { usePanel } from "../../app/context";
import { Busy, Empty, Field } from "../../components/ui";
import Select from "../../components/ui/Select";
import Traffic from "./Traffic";
export default function TrafficPage() {
  const p = usePanel(),
    [selected, setSelected] = useState("");
  const scan = useInstances(p);
  const key = (i: Scan["items"][number]) =>
    [i.accountId, i.region, i.id].join(":");
  const instance =
    scan.data?.items.find((i) => key(i) === selected) || scan.data?.items[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            <ArrowDownUp size={23} />
            流量统计
          </h1>
          <p>查看每台实例的入站、出站流量及按日汇总</p>
        </div>
      </div>
      <section className="form-panel">
        <Field label="统计实例">
          <Select
            value={instance ? key(instance) : ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="" disabled>
              选择实例
            </option>
            {scan.data?.items.map((i) => (
              <option key={key(i)} value={key(i)}>
                {i.name} · {i.accountName} · {regionLabel(i.region)}
              </option>
            ))}
          </Select>
        </Field>
      </section>
      <ScanNotices scan={scan.data} />
      {scan.loading && !scan.data ? (
        <Busy />
      ) : instance ? (
        <Traffic instance={instance} />
      ) : (
        <Empty
          title="当前范围没有实例"
          description="先连接账户或切换区域，再选择实例。"
        />
      )}
    </>
  );
}
