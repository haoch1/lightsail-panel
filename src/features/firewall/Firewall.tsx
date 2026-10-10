import { useInstances } from "../../hooks/useInstances";
import ScanNotices from "../../components/ScanNotices";
import { regionLabel } from "../../../shared/regions";
import { Shield } from "lucide-react";
import { useState } from "react";
import type { Scan } from "../../../shared/types";
import { usePanel } from "../../app/context";
import { Busy, Empty, Field } from "../../components/ui";
import Select from "../../components/ui/Select";
import Ports from "./Ports";
export default function Firewall() {
  const p = usePanel();
  const data = useInstances(p);
  const [selected, setSelected] = useState("");
  const key = (i: Scan["items"][number]) =>
    [i.accountId, i.region, i.id].join(":");
  const instance =
    data.data?.items.find((i) => key(i) === selected) || data.data?.items[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            <Shield size={23} />
            防火墙
          </h1>
          <p>按实例管理 Lightsail 的 IPv4 / IPv6 公网端口与来源网段</p>
        </div>
      </div>
      <section className="form-panel">
        <Field label="防火墙目标实例">
          <Select
            value={instance ? key(instance) : ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="" disabled>
              选择实例
            </option>
            {data.data?.items.map((i) => (
              <option key={key(i)} value={key(i)}>
                {i.name} · {i.accountName} · {regionLabel(i.region)}
              </option>
            ))}
          </Select>
        </Field>
      </section>
      <ScanNotices scan={data.data} />
      {data.loading && !data.data ? (
        <Busy />
      ) : instance ? (
        <Ports key={key(instance)} instance={instance} />
      ) : (
        <Empty
          title="当前范围没有实例"
          description="先添加账户或切换区域，再选择需要配置的实例。"
        />
      )}
    </>
  );
}
