import { regionLabel } from "../../../shared/regions";
import { Plus, Timer } from "lucide-react";
import { useState } from "react";
import type { ScopedStaticIp } from "../../../shared/types";
import { usePanel } from "../../app/context";
import ScanNotices from "../../components/ScanNotices";
import { useInstances } from "../../hooks/useInstances";
import { useResourceScan } from "../../hooks/useResourceScan";
import { staticIpSource } from "../../lib/static-ip-scan";
import {
  Busy,
  CopyText,
  Empty,
  ErrorBox,
  Field,
  Modal,
  PendingButton,
  RefreshButton,
} from "../../components/ui";
import Select from "../../components/ui/Select";
import { api } from "../../lib/api";
import AllocateStaticIp from "./AllocateStaticIp";
import LaunchNetworkStatus from "../launch/LaunchNetworkStatus";
import { useOperationJobs } from "../../hooks/useResourceUpdates";
export default function StaticIps() {
  const panel = usePanel();
  const jobs = useOperationJobs();
  const pending = (ip: ScopedStaticIp) =>
    jobs.some(
      (job) =>
        job.status === "pending" &&
        job.accountId === ip.accountId &&
        job.region === ip.region &&
        ((!!ip.attachedTo && job.targetInstance === ip.attachedTo) ||
          job.instances.some(
            (item) => item.name === ip.name || item.name === ip.attachedTo,
          )),
    );
  const { accountId, region, accounts } = panel;
  const scope = { accountId, region, accounts };
  const data = useResourceScan(scope, staticIpSource);
  const [dialog, setDialog] = useState<{
      action: string;
      ip?: ScopedStaticIp;
    } | null>(null),
    [target, setTarget] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  // Only query attach targets when that dialog is open, in the IP's own scope.
  const instances = useInstances({
    accounts: dialog?.action === "attach" ? accounts : [],
    accountId: dialog?.ip?.accountId || accountId,
    region: dialog?.ip?.region || region,
  });
  function open(action: string, ip?: ScopedStaticIp) {
    setError("");
    setConfirm("");
    setTarget("");
    setDialog({ action, ip });
  }
  async function run() {
    if (busy || !dialog?.ip || dialog.action === "allocate") return;
    setBusy(true);
    try {
      const result = await api("/static-ips", {
        accountId: dialog.ip.accountId,
        region: dialog.ip.region,
        action: dialog.action,
        name: dialog.ip.name,
        instanceName:
          dialog.action === "detach" ? dialog.ip.attachedTo : target,
        confirm,
      });
      panel.toast(result.notice || "静态 IP 操作已提交");
      setDialog(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<string, string> = {
    allocate: "分配静态 IP",
    attach: "绑定静态 IP",
    detach: "解绑静态 IP",
    release: "释放静态 IP",
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            <Timer size={23} />
            静态 IP
          </h1>
          <p>管理 Lightsail 静态公网地址与实例绑定</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="toolbar-actions">
          <RefreshButton
            text="刷新"
            onClick={data.refresh}
            loading={data.loading}
          />
          <button
            className="button primary"
            disabled={!panel.accounts.length}
            onClick={() => open("allocate")}
          >
            <Plus size={15} />
            分配静态 IP
          </button>
        </div>
      </div>
      <ScanNotices scan={data.data} />
      <LaunchNetworkStatus resource="static-ips" />
      <div className="table-wrap">
        <table className="responsive-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>公网 IP</th>
              <th>绑定实例</th>
              <th>账户 / 区域</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.data?.items.map((ip) => (
              <tr key={`${ip.accountId}:${ip.region}:${ip.name}`}>
                <td data-label="名称">{ip.name}</td>
                <td data-label="公网 IP">
                  <CopyText text={ip.ipAddress} toast={panel.toast} />
                </td>
                <td data-label="绑定实例">{ip.attachedTo || "—"}</td>
                <td data-label="账户 / 区域">
                  {ip.accountName}
                  <div className="subline">{regionLabel(ip.region)}</div>
                </td>
                <td data-label="状态">{ip.isAttached ? "已绑定" : "未绑定"}</td>
                <td data-label="操作">
                  <div className="row-actions">
                    <button
                      className="button small"
                      disabled={pending(ip)}
                      onClick={() =>
                        open(ip.isAttached ? "detach" : "attach", ip)
                      }
                    >
                      {ip.isAttached ? "解绑" : "绑定"}
                    </button>
                    <button
                      className="button small danger-text"
                      disabled={ip.isAttached || pending(ip)}
                      onClick={() => open("release", ip)}
                    >
                      释放
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.loading && !data.data && <Busy />}
        {!data.loading && !data.data?.items.length && (
          <Empty
            title={accounts.length ? "暂无静态 IP" : "先添加 AWS 账户"}
            description={
              accounts.length
                ? "可以为 Lightsail 实例分配一个固定公网地址。"
                : "通过顶部的“AWS 账户管理”添加并验证账户。"
            }
          />
        )}
      </div>
      <div className="notice">
        未绑定到实例的静态 IP 可能产生费用。释放后不能保证再次获得相同地址。
      </div>
      {dialog?.action === "allocate" && (
        <AllocateStaticIp
          onClose={() => setDialog(null)}
          onDone={() => setDialog(null)}
        />
      )}
      {dialog && dialog.action !== "allocate" && (
        <Modal
          title={labels[dialog.action]}
          description={
            dialog.ip?.name +
            " · " +
            dialog.ip?.accountName +
            " · " +
            regionLabel(dialog.ip?.region || region)
          }
          busy={busy}
          onClose={() => setDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            {dialog.action === "attach" && (
              <>
                <Field label="目标实例">
                  <Select
                    pending={busy}
                    required
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">选择实例</option>
                    {instances.data?.items
                      .filter(
                        (i) =>
                          !i.staticIp &&
                          i.state !== "terminated" &&
                          i.ipAddressType !== "ipv6",
                      )
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <ScanNotices scan={instances.data} />
              </>
            )}
            {dialog.action === "detach" && (
              <div className="notice">
                解绑后实例公网地址将变化，现有连接可能中断。该静态 IP 会保留。
              </div>
            )}
            {dialog.action === "release" && (
              <>
                <div className="notice danger-notice">
                  地址将被释放，无法撤销。
                </div>
                <Field label="输入名称确认释放">
                  <input
                    data-pending={busy || undefined}
                    disabled={busy}
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={dialog.ip?.name}
                  />
                </Field>
              </>
            )}
            {error && <ErrorBox message={error} />}
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                取消
              </button>
              <PendingButton
                busy={busy}
                pendingLabel="正在提交…"
                className={
                  "button " +
                  (dialog.action === "release" ? "danger" : "primary")
                }
                disabled={
                  dialog.action === "release" && confirm !== dialog.ip?.name
                }
              >
                确认
              </PendingButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
