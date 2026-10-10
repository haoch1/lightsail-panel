import ScanNotices from "../../components/ScanNotices";
import { regionLabel } from "../../../shared/regions";
import {
  ArrowDownUp,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Cloud,
  Gauge,
  Network,
  Play,
  Rocket,
  RotateCw,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Instance } from "../../../shared/types";
import { usePanel } from "../../app/context";
import { useInstances } from "../../hooks/useInstances";
import { useInstanceUsage } from "../../hooks/useInstanceUsage";
import { instanceKey } from "../../lib/instance-usage";
import { menuPosition } from "../../lib/menu-position";
import { InstanceRate, MonthlyTraffic } from "./UsageCells";
import {
  Busy,
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
import LaunchNetworkStatus from "../launch/LaunchNetworkStatus";
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
type Dialog = {
  kind: "action" | "details" | "ports" | "traffic" | "traffic-limit";
  instance: Instance;
  action?: string;
};
export default function Instances() {
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
  const [menu, setMenu] = useState<{
    instance: Instance;
    x: number;
    y: number;
    anchor?: { right: number; top: number; bottom: number };
    maxHeight?: number;
  } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
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
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const scrolled = (e: Event) => {
      if (!menuElement.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("click", close);
    document.addEventListener("scroll", scrolled, true);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        menuTrigger.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("scroll", scrolled, true);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);
  useLayoutEffect(() => {
    const element = menuElement.current;
    if (!menu || !element) return;
    const rect = element.getBoundingClientRect();
    const position = menu.anchor
      ? menuPosition(menu.anchor, rect.width, element.scrollHeight + 2, {
          width: innerWidth,
          height: innerHeight,
        })
      : {
          x: Math.max(8, Math.min(menu.x, innerWidth - rect.width - 8)),
          y: Math.max(8, Math.min(menu.y, innerHeight - rect.height - 8)),
          maxHeight: undefined,
        };
    if (
      position.x !== menu.x ||
      position.y !== menu.y ||
      position.maxHeight !== menu.maxHeight
    )
      setMenu({ ...menu, ...position });
    if (!element.contains(document.activeElement))
      element
        .querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
  }, [menu]);
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
    setMenu(null);
    if (action === "start") void run(i, action);
    else setDialog({ kind: "action", instance: i, action });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            <Cloud size={23} /> Lightsail 实例
          </h1>
          <p>管理 Lightsail 实例、运行状态与公网 IP</p>
        </div>
      </div>
      <>
        <div className="toolbar">
          <div className="toolbar-actions">
            <RefreshButton onClick={refresh} loading={loading} />
            <button
              className="button primary"
              onClick={() => navigate("/lightsail/launch")}
            >
              <Rocket size={16} />
              启动新实例
            </button>
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
          <div className="toolbar-filters">
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
          </div>
        </div>
        <div className="table-caption">
          <span>点击实例右侧“操作”可管理网络与流量。</span>
          <span>{data ? "共 " + data.items.length + " 个实例" : ""}</span>
        </div>
        <ScanNotices scan={data} />
        <LaunchNetworkStatus />
        <div className="table-wrap">
          <table className="instance-table">
            <thead>
              <tr>
                <th className="check-cell">
                  <Checkbox
                    aria-label="全选实例"
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
              {items.map((i) => (
                <tr
                  key={keyOf(i)}
                  className={selected.includes(keyOf(i)) ? "selected" : ""}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      instance: i,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  <td className="check-cell">
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
                  </td>
                  <td>
                    <button
                      className="instance-name"
                      onClick={() =>
                        setDialog({ kind: "details", instance: i })
                      }
                    >
                      {i.name}
                    </button>
                  </td>
                  <td>
                    <State value={i.state} />
                    <div className="subline">{i.platform}</div>
                  </td>
                  <td>
                    <div>{i.instanceType}</div>
                    <div className="subline">
                      {i.cpu === undefined ? "—" : whole(i.cpu)} vCPU ·{" "}
                      {i.memory === undefined ? "—" : memoryLabel(i.memory)}
                    </div>
                    <InstanceRate usage={usage.values[instanceKey(i)]} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="traffic-link"
                      aria-label={i.name + " 本月流量"}
                      onClick={() =>
                        setDialog({ kind: "traffic", instance: i })
                      }
                    >
                      <MonthlyTraffic usage={usage.values[instanceKey(i)]} />
                    </button>
                  </td>
                  <td>
                    <InstanceAddresses instance={i} toast={toast} />
                  </td>
                  <td>
                    <span>{i.accountName}</span>
                    <div className="subline">{regionLabel(i.region)}</div>
                  </td>
                  <td>
                    <div className="row-actions instance-row-actions">
                      <button
                        className="button small instance-actions-button"
                        aria-label={i.name + " 操作"}
                        aria-haspopup="menu"
                        aria-expanded={menu?.instance === i}
                        onClick={(e) => {
                          e.stopPropagation();
                          menuTrigger.current = e.currentTarget;
                          const r = e.currentTarget.getBoundingClientRect();
                          setMenu({
                            instance: i,
                            x: r.right,
                            y: r.bottom + 6,
                            anchor: {
                              right: r.right,
                              top: r.top,
                              bottom: r.bottom,
                            },
                          });
                        }}
                      >
                        操作 <ChevronDown size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && !data && <Busy />}
          {!loading && !data?.errors.length && items.length === 0 && (
            <Empty
              title={
                !accounts.length
                  ? "尚未连接 AWS 账户"
                  : search || status !== "all"
                    ? "没有匹配的实例"
                    : "暂无实例"
              }
              description={
                !accounts.length
                  ? "先添加并验证 AWS 凭证，即可加载真实资源。"
                  : "试试其他账户或区域，或创建你的第一台实例。"
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
        {data?.at && (
          <div className="table-footer">
            <span>上次刷新 {when(data.at)}</span>
          </div>
        )}
      </>
      {menu && (
        <div
          ref={menuElement}
          className="context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y, maxHeight: menu.maxHeight }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const items = [
              ...(menuElement.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ) || []),
            ];
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? items.length - 1
                  : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                    items.length;
            items[next]?.focus({ preventScroll: true });
          }}
        >
          <div className="menu-title">{menu.instance.name}</div>
          <div className="menu-power-actions">
            <button
              role="menuitem"
              disabled={menu.instance.state !== "stopped"}
              onClick={() => command(menu.instance, "start")}
            >
              <Play />
              启动
            </button>
            <button
              role="menuitem"
              disabled={menu.instance.state !== "running"}
              onClick={() => command(menu.instance, "stop")}
            >
              <Square />
              停止
            </button>
            <button
              role="menuitem"
              disabled={menu.instance.state !== "running"}
              onClick={() => command(menu.instance, "reboot")}
            >
              <RotateCw />
              重启
            </button>
          </div>
          <hr />
          <button
            role="menuitem"
            disabled={
              menu.instance.state !== "running" ||
              menu.instance.ipAddressType === "ipv6"
            }
            onClick={() => command(menu.instance, "rotate-ip")}
          >
            <ArrowLeftRight />
            更换公网 IP
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setDialog({ kind: "details", instance: menu.instance });
              setMenu(null);
            }}
          >
            <Network />
            实例详情
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setDialog({ kind: "traffic", instance: menu.instance });
              setMenu(null);
            }}
          >
            <ArrowDownUp />
            流量统计
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setDialog({ kind: "traffic-limit", instance: menu.instance });
              setMenu(null);
            }}
          >
            <Gauge />
            自动关机
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setDialog({ kind: "ports", instance: menu.instance });
              setMenu(null);
            }}
          >
            <ShieldCheck />
            防火墙设置
          </button>
          <button
            role="menuitem"
            onClick={() =>
              command(
                menu.instance,
                menu.instance.ipv6?.length ||
                  menu.instance.ipAddressType === "ipv6" ||
                  menu.instance.ipAddressType === "dualstack"
                  ? "disable-ipv6"
                  : "enable-ipv6",
              )
            }
          >
            <Network />
            {menu.instance.ipv6?.length ||
            menu.instance.ipAddressType === "ipv6" ||
            menu.instance.ipAddressType === "dualstack"
              ? "关闭 IPv6"
              : "启用 IPv6"}
          </button>
          <hr />
          <button
            role="menuitem"
            className="danger-text"
            onClick={() => command(menu.instance, "terminate")}
          >
            <Trash2 />
            删除实例
          </button>
        </div>
      )}
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
    </>
  );
}
