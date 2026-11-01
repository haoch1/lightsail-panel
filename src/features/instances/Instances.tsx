import { InventoryTable } from "../../components/ui/InventoryTable";
import ScanNotices from "../../components/ScanNotices";
import { regionLabel, regionNames } from "../../../shared/regions";
import {
  ArrowDownUp,
  ArrowLeftRight,
  ChevronRight,
  Cloud,
  Gauge,
  Network,
  Play,
  Rocket,
  RotateCw,
  ShieldCheck,
  Square,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import type { Instance } from "../../../shared/types";
import { usePanel } from "../../app/context";
import { useInstances } from "../../hooks/useInstances";
import { useInstanceUsage } from "../../hooks/useInstanceUsage";
import { instanceKey } from "../../lib/instance-usage";
import { InstanceRate, MonthlyTraffic } from "./UsageCells";
import {
  TableLoading,
  Checkbox,
  Empty,
  ErrorBox,
  Modal,
  PendingButton,
  RefreshButton,
  SearchInput,
  State,
  targetOf,
  when,
} from "../../components/ui";
import Select from "../../components/ui/Select";
import { ActionMenu } from "../../components/ui/ActionMenu";
import { InventoryTrafficHeading } from "../../components/ui/InventoryTrafficHeading";
import LaunchNetworkStatus from "../launch/LaunchNetworkStatus";
import { useOperationJobs } from "../../hooks/useResourceUpdates";
import { api } from "../../lib/api";
import { whole } from "../../lib/format";
import { memoryLabel } from "../../lib/bundle";
import ActionDialog from "./ActionDialog";
import { actionNames } from "./actions";
import Details from "./Details";
import InstanceAddresses from "./InstanceAddresses";
import Ports from "../firewall/Ports";
import Traffic from "../monitoring/Traffic";
import TrafficLimit from "../monitoring/TrafficLimit";
const SshTerminal = lazy(() => import("../ssh/SshTerminal"));
type Dialog = {
  kind: "action" | "details" | "ports" | "traffic" | "traffic-limit" | "ssh";
  instance: Instance;
  action?: string;
};
export default function Instances() {
  const jobs = useOperationJobs();
  const pending = (i: Instance) =>
    jobs.some(
      (job) =>
        job.status === "pending" &&
        job.accountId === i.accountId &&
        job.region === i.region &&
        (job.targetInstance === i.id ||
          job.instances.some((item) => item.name === i.id)),
    );
  const service = "lightsail";
  const { accounts, accountId, region, toast, navigate, openAccounts } =
    usePanel();
  const {
    data,
    loading,
    refresh: refreshScan,
  } = useInstances({
    accounts,
    accountId,
    region,
  });
  const usage = useInstanceUsage(data?.items || []);
  const refresh = () => {
    refreshScan();
    usage.refresh();
  };
  const [search, setSearch] = useState("");
  const filter = useDeferredValue(search);
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const keyOf = (i: Instance) => `${i.accountId}:${i.region}:${i.id}`;
  const items = (data?.items || []).filter(
    (i) =>
      (status === "all" || i.state === status) &&
      [
        i.name,
        i.id,
        i.publicIp,
        i.ipv6?.join(" "),
        i.accountName,
        i.region,
      ].some((s) => s?.toLowerCase().includes(filter.toLowerCase())),
  );
  const chosen = (data?.items || []).filter((i) => selected.includes(keyOf(i)));
  useEffect(() => {
    setSelected([]);
    setMenu(null);
  }, [accountId, region, service]);
  async function run(
    i: Instance,
    action: string,
    confirm = "",
    acceptBundleUpdate = false,
  ) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const r = await api("/instances/action", {
        ...targetOf(i),
        action,
        confirm,
        acceptBundleUpdate,
      });
      toast(r.notice || "操作已提交，正在跟踪实例状态");
      setDialog(null);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  function command(i: Instance, action: string) {
    if (submitting.current) return;
    if (action === "start") void run(i, action);
    else setDialog({ kind: "action", instance: i, action });
  }
  return (
    <div className="instance-inventory">
      <div className="page-heading instances-heading">
        <div>
          <h1>
            <Cloud size={23} /> Lightsail 实例
          </h1>
        </div>
        <div className="row-actions">
          <RefreshButton onClick={refresh} loading={loading} />
          <button
            className="button primary"
            onClick={() => navigate("/lightsail/launch")}
          >
            <Rocket size={16} />
            创建实例
          </button>
        </div>
      </div>
      <div className="instances-overview">
        <div className="instance-counts" aria-label="实例概况">
          <span>
            实例 <strong>{data ? data.items.length : "—"}</strong>
          </span>
          <span>
            运行中{" "}
            <strong>
              {data
                ? data.items.filter((i) => i.state === "running").length
                : "—"}
            </strong>
          </span>
          <span>
            已停止{" "}
            <strong>
              {data
                ? data.items.filter((i) => i.state === "stopped").length
                : "—"}
            </strong>
          </span>
        </div>
        <div className="instance-times">
          {data?.at && (
            <span
              title={`实例更新：${when(data.itemsAt || data.at)}${usage.at ? `\n流量更新：${when(usage.at)}` : ""}`}
            >
              上次刷新{" "}
              {when(
                [data.itemsAt || data.at, usage.at].filter(Boolean).sort()[0],
              )}
            </span>
          )}
        </div>
      </div>
      <ScanNotices scan={data} />
      <LaunchNetworkStatus />
      <div className="table-panel">
        <div className="toolbar table-toolbar instances-toolbar">
          <div className="toolbar-actions">
            <SearchInput value={search} onChange={setSearch} />
            <Select
              aria-label="实例状态"
              menuClassName="instance-status-menu"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">全部状态</option>
              <option value="running">运行中</option>
              <option value="stopped">已停止</option>
              <option value="pending">启动中</option>
              <option value="terminated">已终止</option>
            </Select>
            <label className="inventory-select-all">
              <Checkbox
                aria-label="选择所有筛选结果"
                indeterminate={
                  items.some((i) => selected.includes(keyOf(i))) &&
                  !items.every((i) => selected.includes(keyOf(i)))
                }
                checked={
                  !!items.length &&
                  items.every((i) => selected.includes(keyOf(i)))
                }
                onChange={(e) =>
                  setSelected(e.target.checked ? items.map(keyOf) : [])
                }
              />
              <span>全选</span>
            </label>
          </div>
          <div className="toolbar-actions">
            {chosen.length > 0 && (
              <>
                <button className="button" onClick={() => setBulk("start")}>
                  <Play size={14} />
                  批量启动
                </button>
                <button className="button" onClick={() => setBulk("stop")}>
                  <Square size={14} />
                  批量停止
                </button>
                <span className="muted">已选 {chosen.length} 台</span>
              </>
            )}
          </div>
        </div>
        <div className="table-wrap">
          <InventoryTable
            className="instance-table responsive-table inventory-table"
            aria-label="Lightsail 实例"
          >
            <thead>
              <tr>
                <th className="check-cell">
                  <Checkbox
                    aria-label="全选实例"
                    indeterminate={
                      items.some((i) => selected.includes(keyOf(i))) &&
                      !items.every((i) => selected.includes(keyOf(i)))
                    }
                    checked={
                      !!items.length &&
                      items.every((i) => selected.includes(keyOf(i)))
                    }
                    onChange={(e) =>
                      setSelected(e.target.checked ? items.map(keyOf) : [])
                    }
                  />
                </th>
                <th>实例</th>
                <th>状态</th>
                <th>规格 / 价格</th>
                <th>本月流量</th>
                <th>网络</th>
                <th>账户 / 区域</th>
                <th className="instance-actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data?.items.length && (
                <TableLoading
                  columns={[
                    "",
                    "实例",
                    "状态",
                    "规格 / 价格",
                    "本月流量",
                    "网络",
                    "账户 / 区域",
                    "操作",
                  ]}
                  lines={[1, 1, 1, 3, 3, 3, 2, 1]}
                />
              )}
              {items.map((i) => (
                <tr
                  key={keyOf(i)}
                  className={
                    "resource-row " +
                    (selected.includes(keyOf(i)) ? "selected" : "")
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu(keyOf(i));
                  }}
                >
                  <td className="check-cell">
                    <label className="selection-box">
                      <Checkbox
                        aria-label={"选择 " + i.name}
                        checked={selected.includes(keyOf(i))}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, keyOf(i)]
                              : s.filter((x) => x !== keyOf(i)),
                          )
                        }
                      />
                    </label>
                  </td>
                  <td data-label="实例">
                    <button
                      className="instance-name"
                      onClick={() =>
                        setDialog({ kind: "details", instance: i })
                      }
                    >
                      {i.name}
                    </button>
                  </td>
                  <td data-label="状态">
                    <State value={i.state} />
                  </td>
                  <td data-label="规格 / 价格">
                    <div>{i.instanceType}</div>
                    <div className="subline">
                      {i.cpu === undefined ? "—" : whole(i.cpu)} vCPU ·{" "}
                      {i.memory === undefined ? "—" : memoryLabel(i.memory)}
                    </div>
                    <InstanceRate usage={usage.values[instanceKey(i)]} />
                  </td>
                  <td data-label="本月流量">
                    <button
                      type="button"
                      className="traffic-link"
                      aria-label={i.name + " 本月流量"}
                      onClick={() =>
                        setDialog({ kind: "traffic", instance: i })
                      }
                    >
                      <InventoryTrafficHeading />
                      <MonthlyTraffic usage={usage.values[instanceKey(i)]} />
                    </button>
                  </td>
                  <td data-label="网络">
                    <InstanceAddresses instance={i} toast={toast} />
                  </td>
                  <td data-label="账户 / 区域">
                    <span>{i.accountName}</span>
                    <div className="subline instance-region">
                      {regionNames[i.region] && (
                        <>
                          <span>{regionNames[i.region]}</span>
                          {" · "}
                        </>
                      )}
                      <span>{i.region}</span>
                    </div>
                  </td>
                  <td data-label="操作">
                    <div className="row-actions instance-row-actions">
                      <ActionMenu
                        label={i.name}
                        open={menu === keyOf(i)}
                        onOpenChange={(open) => setMenu(open ? keyOf(i) : null)}
                      >
                        <div className="menu-power-actions">
                          <button
                            role="menuitem"
                            disabled={pending(i) || i.state !== "stopped"}
                            onClick={() => command(i, "start")}
                          >
                            <Play />
                            <span>启动</span>
                          </button>
                          <button
                            role="menuitem"
                            disabled={pending(i) || i.state !== "running"}
                            onClick={() => command(i, "stop")}
                          >
                            <Square />
                            <span>停止</span>
                          </button>
                          <button
                            role="menuitem"
                            disabled={pending(i) || i.state !== "running"}
                            onClick={() => command(i, "reboot")}
                          >
                            <RotateCw />
                            <span>重启</span>
                          </button>
                        </div>
                        <hr />
                        <button
                          role="menuitem"
                          disabled={i.state !== "running"}
                          onClick={() => {
                            setDialog({ kind: "ssh", instance: i });
                          }}
                        >
                          <TerminalSquare />
                          <span>SSH 终端</span>
                        </button>
                        <button
                          role="menuitem"
                          disabled={
                            i.state !== "running" ||
                            pending(i) ||
                            i.ipAddressType === "ipv6"
                          }
                          onClick={() => command(i, "rotate-ip")}
                        >
                          <ArrowLeftRight />
                          <span>更换公网 IP</span>
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setDialog({ kind: "details", instance: i });
                          }}
                        >
                          <Network />
                          <span>实例详情</span>
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setDialog({ kind: "traffic", instance: i });
                          }}
                        >
                          <ArrowDownUp />
                          <span>流量统计</span>
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setDialog({ kind: "traffic-limit", instance: i });
                          }}
                        >
                          <Gauge />
                          <span>自动关机</span>
                        </button>
                        <button
                          role="menuitem"
                          onClick={() => {
                            setDialog({ kind: "ports", instance: i });
                          }}
                        >
                          <ShieldCheck />
                          <span>防火墙设置</span>
                        </button>
                        <button
                          role="menuitem"
                          disabled={pending(i)}
                          onClick={() =>
                            command(
                              i,
                              i.ipv6?.length ||
                                i.ipAddressType === "ipv6" ||
                                i.ipAddressType === "dualstack"
                                ? "disable-ipv6"
                                : "enable-ipv6",
                            )
                          }
                        >
                          <Network />
                          <span>
                            {i.ipv6?.length ||
                            i.ipAddressType === "ipv6" ||
                            i.ipAddressType === "dualstack"
                              ? "关闭 IPv6"
                              : "启用 IPv6"}
                          </span>
                        </button>
                        <hr />
                        <button
                          role="menuitem"
                          className="danger-text"
                          disabled={pending(i)}
                          onClick={() => command(i, "terminate")}
                        >
                          <Trash2 />
                          <span>删除实例</span>
                        </button>
                      </ActionMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </InventoryTable>
          {!loading && !data?.errors.length && items.length === 0 && (
            <Empty
              title={
                !accounts.length
                  ? "尚未连接 AWS 账户"
                  : search || status !== "all"
                    ? "没有匹配的实例"
                    : "暂无实例"
              }
              action={
                <button
                  className="button"
                  onClick={() =>
                    accounts.length
                      ? navigate("/lightsail/launch")
                      : openAccounts()
                  }
                >
                  {accounts.length ? "创建实例" : "添加 AWS 账户"}
                  <ChevronRight size={14} />
                </button>
              }
            />
          )}
        </div>
      </div>
      {dialog?.kind === "action" && (
        <ActionDialog
          instance={dialog.instance}
          action={dialog.action!}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={(confirm, acceptBundleUpdate) =>
            run(dialog.instance, dialog.action!, confirm, acceptBundleUpdate)
          }
        />
      )}
      {dialog?.kind === "ssh" && (
        <Suspense fallback={null}>
          <SshTerminal
            instance={dialog.instance}
            onClose={() => setDialog(null)}
          />
        </Suspense>
      )}
      {dialog?.kind === "traffic" && (
        <Modal
          wide
          title="流量统计"
          className="traffic-modal"
          description={
            dialog.instance.name + " · " + regionLabel(dialog.instance.region)
          }
          onClose={() => setDialog(null)}
        >
          <Traffic instance={dialog.instance} />
        </Modal>
      )}
      {dialog?.kind === "traffic-limit" && (
        <TrafficLimit
          instance={dialog.instance}
          initialUsage={usage.values[instanceKey(dialog.instance)]}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "details" && (
        <Details instance={dialog.instance} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "ports" && (
        <Modal
          wide
          title="防火墙设置"
          className="firewall-modal"
          description={dialog.instance.name}
          onClose={() => setDialog(null)}
        >
          <Ports instance={dialog.instance} />
        </Modal>
      )}
      {bulk && (
        <Modal
          title={`批量${actionNames[bulk]}`}
          description={`将对已选 ${chosen.length} 台实例提交操作。`}
          busy={busy}
          onClose={() => setBulk(null)}
        >
          <p className="muted">{chosen.map((i) => i.name).join("、")}</p>
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => setBulk(null)}
            >
              取消
            </button>
            <PendingButton
              className="button primary"
              busy={busy}
              pendingLabel="正在提交…"
              onClick={async () => {
                if (submitting.current) return;
                submitting.current = true;
                setBusy(true);
                let success = 0;
                const failures: string[] = [];
                for (const i of chosen) {
                  try {
                    await api("/instances/action", {
                      ...targetOf(i),
                      action: bulk,
                    });
                    success++;
                  } catch (e) {
                    failures.push(i.name + ": " + (e as Error).message);
                  }
                }
                toast(
                  `已提交 ${success} 台${failures.length ? "，失败 " + failures.length + " 台" : ""}`,
                  failures.length ? "error" : "success",
                );
                if (failures.length) toast(failures.join("；"), "error");
                submitting.current = false;
                setBusy(false);
                setBulk(null);
                setSelected([]);
              }}
            >
              确认{actionNames[bulk]}
            </PendingButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
