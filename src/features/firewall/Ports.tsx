import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import type { Instance, PortInfo } from "../../../shared/types";
import { useApi, usePanel } from "../../app/context";
import {
  Busy,
  Empty,
  ErrorBox,
  Modal,
  PendingButton,
  RefreshButton,
  targetOf,
} from "../../components/ui";
import { api, query } from "../../lib/api";
import PortRuleEditor from "./PortRuleEditor";
import { applicationLabel, portLabel } from "./presets";
import LaunchNetworkStatus from "../launch/LaunchNetworkStatus";
export default function Ports({ instance }: { instance: Instance }) {
  const panel = usePanel(),
    target = targetOf(instance),
    data = useApi<{ items: PortInfo[] }>("/ports?" + query(target));
  const [add, setAdd] = useState(false),
    [remove, setRemove] = useState<PortInfo | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function submit(portInfo: PortInfo, close = false) {
    if (submitting.current) return;
    if (!close && instance.ipAddressType === "ipv6" && portInfo.cidrs?.length) {
      setError("仅 IPv6 实例请使用 IPv6 来源网段，例如 ::/0 或 2001:db8::/64");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api("/ports", { ...target, portInfo, close });
      panel.toast(result.notice || "防火墙规则已提交");
      setAdd(false);
      setRemove(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="ports-content" aria-busy={data.loading}>
      <div className="toolbar">
        <div className="toolbar-actions">
          <RefreshButton loading={data.loading} onClick={data.refresh} />
          <button
            className="button primary"
            onClick={() => {
              setError("");
              setAdd(true);
            }}
          >
            <Plus size={14} />
            开放端口
          </button>
        </div>
      </div>
      <div className="notice">
        规则控制 Lightsail 实例的公网访问；实例内部的系统防火墙需单独配置。
      </div>
      {data.error && <ErrorBox message={data.error} retry={data.refresh} />}
      <LaunchNetworkStatus resource="ports" instance={instance} />
      <div className="table-wrap firewall-table">
        <table>
          <thead>
            <tr>
              <th>应用程序</th>
              <th>协议</th>
              <th>端口</th>
              <th>允许来源</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.data?.items.map((r, index) => (
              <tr key={index}>
                <td>
                  <strong>
                    {applicationLabel(r.protocol, r.fromPort, r.toPort)}
                  </strong>
                </td>
                <td>{r.protocol.toUpperCase()}</td>
                <td>{portLabel(r.protocol, r.fromPort, r.toPort)}</td>
                <td className="firewall-sources">
                  {[
                    ...(r.cidrs || []),
                    ...(r.ipv6Cidrs || []),
                    ...(r.cidrListAliases || []),
                  ].join(", ") || "AWS 默认来源"}
                </td>
                <td>
                  <button
                    className="button small danger-text"
                    onClick={() => {
                      setError("");
                      setRemove(r);
                    }}
                  >
                    关闭端口
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.loading && !data.data && <Busy />}
        {!data.loading && !data.data?.items.length && (
          <Empty title="暂无开放的公网端口" />
        )}
      </div>
      {add && (
        <PortRuleEditor
          instance={instance}
          busy={busy}
          error={error}
          onClose={() => setAdd(false)}
          onSubmit={(rule) => void submit(rule)}
        />
      )}
      {remove && (
        <Modal title="确认关闭端口" busy={busy} onClose={() => setRemove(null)}>
          <div className="notice danger-notice">
            关闭 {remove.protocol.toUpperCase()} {remove.fromPort}–
            {remove.toPort} 后，相关公网连接可能中断。
          </div>
          {error && <ErrorBox message={error} />}
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              取消
            </button>
            <PendingButton
              className="button danger"
              busy={busy}
              pendingLabel="正在提交…"
              onClick={() => submit(remove, true)}
            >
              确认关闭
            </PendingButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
