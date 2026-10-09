import { awsRegionOptions, regionLabel } from "../../shared/regions";
import {
  AlertCircle,
  ArrowDownUp,
  ArrowUpRight,
  CheckCircle,
  Cloud,
  FlaskConical,
  Globe,
  LogOut,
  Menu,
  Rocket,
  ScrollText,
  Shield,
  Timer,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Account, Region, ToastFn } from "../../shared/types";
import { Busy, ErrorBox } from "../components/ui";
import Select from "../components/ui/Select";
import Accounts from "../features/accounts/Accounts";
import Audit from "../features/audit/Audit";
import Auth from "../features/auth/Auth";
import Firewall from "../features/firewall/Firewall";
import Instances from "../features/instances/Instances";
import Launch from "../features/launch/Launch";
import TrafficPage from "../features/monitoring/TrafficPage";
import StaticIps from "../features/networking/StaticIps";
import { api, isDemo, setCsrf } from "../lib/api";
import { PanelContext, useApi } from "./context";
import { ThemeControl } from "./theme";
import { useResourceUpdates } from "../hooks/useResourceUpdates";
const nav = [
  { path: "/lightsail", label: "Lightsail 实例", icon: Cloud },
  { path: "/lightsail/launch", label: "创建实例", icon: Rocket },
  { path: "/lightsail/ips", label: "静态 IP", icon: Timer },
  { path: "/lightsail/firewall", label: "防火墙", icon: Shield },
  { path: "/lightsail/traffic", label: "流量统计", icon: ArrowDownUp },
  { path: "/audit", label: "操作日志", icon: ScrollText },
];
const validPath = (path: string) =>
  nav.some((n) => n.path === path) ? path : "/lightsail";
const initialPath = validPath(location.pathname);
if (initialPath !== location.pathname)
  history.replaceState(null, "", initialPath + location.search);
export default function App() {
  const demo = isDemo();
  const [auth, setAuth] = useState<{
    initialized: boolean;
    authenticated: boolean;
  } | null>(demo ? { initialized: true, authenticated: true } : null);
  const [path, setPath] = useState(initialPath);
  const [accountId, setAccountId] = useState("all");
  const [region, setRegion] = useState("all");
  const [mobile, setMobile] = useState(false);
  const [manageAccounts, setManageAccounts] = useState(false);
  const [notices, setNotices] = useState<
    { id: number; message: string; type: string }[]
  >([]);
  const [authError, setAuthError] = useState("");
  useResourceUpdates(!!auth?.authenticated, demo);
  const toast: ToastFn = (message, type = "success") => {
    const id = Date.now() + Math.random();
    setNotices((n) => [...n.slice(-3), { id, message, type }]);
    setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 5000);
  };
  const accountData = useApi<{ items: Account[] }>(
    auth?.authenticated ? "/accounts" : null,
  );
  const accounts = accountData.data?.items || [];
  const selected = accounts.find((a) => a.id === accountId) || accounts[0];
  const regionData = useApi<{ items: Region[] }>(
    selected ? `/regions?accountId=${selected.id}&service=lightsail` : null,
  );
  const regions = regionData.data?.items || awsRegionOptions;
  useEffect(() => {
    if (
      accountData.data &&
      accountId !== "all" &&
      !accounts.some((a) => a.id === accountId)
    )
      setAccountId("all");
  }, [accountData.data, accountId]);
  useEffect(() => {
    if (demo) return;
    api("/auth")
      .then((a) => {
        setCsrf(a.csrf || "");
        setAuth(a);
      })
      .catch((e) => setAuthError(e.message));
  }, [demo]);
  useEffect(() => {
    const listener = () => {
      setPath(validPath(location.pathname));
      setMobile(false);
    };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  useEffect(() => {
    const expired = () => setAuth({ initialized: true, authenticated: false });
    window.addEventListener("panel:unauthorized", expired);
    return () => window.removeEventListener("panel:unauthorized", expired);
  }, []);
  function navigate(next: string) {
    history.pushState(null, "", next + (demo ? "?demo=1" : ""));
    setPath(next);
    setMobile(false);
    window.scrollTo(0, 0);
  }
  if (!auth) {
    return (
      <div className="auth-wrap">
        {authError ? (
          <ErrorBox message={authError} retry={() => location.reload()} />
        ) : (
          <Busy text="连接面板后端…" />
        )}
      </div>
    );
  }
  if (!auth.authenticated)
    return (
      <Auth
        initialized={auth.initialized}
        onDone={() => {
          setAuth({ initialized: true, authenticated: true });
          accountData.refresh();
        }}
      />
    );
  let page;
  if (accountData.loading && !accountData.data)
    page = <Busy text="加载账户…" />;
  else if (path === "/lightsail/launch") page = <Launch />;
  else if (path === "/lightsail/ips") page = <StaticIps />;
  else if (path === "/lightsail/firewall") page = <Firewall />;
  else if (path === "/lightsail/traffic") page = <TrafficPage />;
  else if (path === "/audit") page = <Audit />;
  else page = <Instances />;
  return (
    <PanelContext.Provider
      value={{
        accounts,
        accountId,
        region,
        regions,
        toast,
        navigate,
        refreshAccounts: accountData.refresh,
        openAccounts: () => setManageAccounts(true),
        setScope: (a, r) => {
          setAccountId(a);
          setRegion(r);
        },
        demo,
      }}
    >
      <div className="shell">
        {mobile && (
          <button
            className="sidebar-mask"
            aria-label="关闭导航"
            onClick={() => setMobile(false)}
          />
        )}
        <aside className={"sidebar " + (mobile ? "open" : "")}>
          <a
            className="brand"
            href={"/lightsail" + (demo ? "?demo=1" : "")}
            onClick={(e) => {
              e.preventDefault();
              navigate("/lightsail");
            }}
          >
            <Cloud size={21} />
            <strong>Lightsail Panel</strong>
          </a>
          <div className="side-nav">
            {nav.map((n) => (
              <a
                key={n.path}
                className={"nav-item " + (path === n.path ? "active" : "")}
                href={n.path + (demo ? "?demo=1" : "")}
                aria-current={path === n.path ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(n.path);
                }}
              >
                <n.icon size={17} />
                <span>{n.label}</span>
              </a>
            ))}
          </div>
          <div className="side-appearance">
            <ThemeControl compact />
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <button
              className="icon-button mobile-menu"
              aria-label="打开导航"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <div className="top-control">
              <span className="top-label">区域范围</span>
              <Select
                className="region-select"
                icon={<Globe size={15} />}
                aria-label="区域范围"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              >
                <option value="all">全部区域</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {regionLabel(r.id)}
                  </option>
                ))}
                {!regions.some((r) => r.id === region) && region !== "all" && (
                  <option value={region}>{regionLabel(region)}</option>
                )}
              </Select>
            </div>
            <div className="top-right">
              <div className="top-control account-control">
                <span className="top-label">账户</span>
                <Select
                  className="account-select"
                  icon={<Cloud size={15} />}
                  aria-label="AWS 账户"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="all">
                    {accounts.length ? "全部账户" : "未添加账户"}
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                className="button small account-manager-button"
                aria-label="管理 AWS 账户"
                onClick={() => setManageAccounts(true)}
              >
                <UsersRound size={15} /> <span>管理</span>
              </button>
              {demo ? (
                <a className="text-link" href="/">
                  连接 AWS <ArrowUpRight size={13} />
                </a>
              ) : (
                <button
                  className="icon-button"
                  aria-label="退出登录"
                  title="退出登录"
                  onClick={async () => {
                    await api("/logout", {});
                    location.reload();
                  }}
                >
                  <LogOut size={16} />
                </button>
              )}
            </div>
          </header>
          {demo && (
            <div className="demo-bar">
              <FlaskConical size={14} />
              <span>演示模式 · 所有数据和操作均为本地示例</span>
              <a href="/">
                退出演示，连接真实账户 <ArrowUpRight size={12} />
              </a>
            </div>
          )}
          <main>
            {accountData.error && (
              <ErrorBox
                message={accountData.error}
                retry={accountData.refresh}
              />
            )}{" "}
            {regionData.error && (
              <ErrorBox
                message={"区域查询失败：" + regionData.error}
                retry={regionData.refresh}
              />
            )}{" "}
            {page}
          </main>
        </div>
        {manageAccounts && (
          <Accounts onClose={() => setManageAccounts(false)} />
        )}
        <div className="toasts" aria-live="polite">
          {notices.map((n) => (
            <div key={n.id} className={"toast " + n.type}>
              {n.type === "error" ? (
                <AlertCircle size={17} />
              ) : (
                <CheckCircle size={17} />
              )}
              <span>{n.message}</span>
              <button
                className="icon-button"
                aria-label="关闭通知"
                onClick={() =>
                  setNotices((a) => a.filter((x) => x.id !== n.id))
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </PanelContext.Provider>
  );
}
