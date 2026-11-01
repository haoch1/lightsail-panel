import { Sidebar } from "../components/ui/Sidebar";
import { usePasswordManagerPolicy } from "../components/ui/usePasswordManagerPolicy";
import { awsRegionOptions } from "../../shared/regions";
import {
  AlertCircle,
  ArrowDownUp,
  ArrowUpRight,
  CheckCircle,
  ChevronRight,
  Cloud,
  LogOut,
  Menu,
  Rocket,
  ScrollText,
  Shield,
  Timer,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Account, Region, ToastFn } from "../../shared/types";
import { ErrorBox } from "../components/ui";
import Settings from "../features/settings/Settings";
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
import { bootstrap } from "../lib/bootstrap";
const nav = [
  { path: "/instances", label: "Lightsail 实例", icon: Cloud },
  { path: "/launch", label: "创建实例", icon: Rocket },
  { path: "/ips", label: "静态 IP", icon: Timer },
  { path: "/firewall", label: "防火墙", icon: Shield },
  { path: "/traffic", label: "流量统计", icon: ArrowDownUp },
  { path: "/audit", label: "操作日志", icon: ScrollText },
  { path: "/settings", label: "设置", icon: SettingsIcon },
];
const validPath = (path: string) =>
  nav.some((n) => n.path === path) ? path : "/instances";
const initialPath = validPath(location.pathname);
if (initialPath !== location.pathname || location.hash)
  history.replaceState(null, "", initialPath + location.search);
export default function App() {
  const demo = isDemo();
  const [auth, setAuth] = useState<{
    initialized: boolean;
    authenticated: boolean;
    expires?: number;
  } | null>(
    demo
      ? {
          initialized: true,
          authenticated: true,
          expires: Date.now() + 720 * 3600000,
        }
      : bootstrap,
  );
  const [path, setPath] = useState(initialPath);
  usePasswordManagerPolicy(auth?.authenticated === false);
  const accountId = "all";
  const region = "all";
  const [mobile, setMobile] = useState(false);
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
  const selected = accounts[0];
  const regionData = useApi<{ items: Region[] }>(
    selected && path === "/launch"
      ? `/regions?accountId=${selected.id}&service=lightsail`
      : null,
  );
  const regions = regionData.data?.items || awsRegionOptions;
  useEffect(() => {
    if (demo || bootstrap) return;
    let active = true;
    api("/auth")
      .then((a) => {
        if (!active) return;
        setCsrf(a.csrf || "");
        setAuth(a);
      })
      .catch((e) => {
        if (active) setAuthError(e.message);
      });
    return () => {
      active = false;
    };
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
    if (path !== next)
      history.pushState(null, "", next + (demo ? "?demo=1" : ""));
    setPath(next);
    setMobile(false);
    window.scrollTo(0, 0);
  }
  if (auth && !auth.authenticated)
    return (
      <Auth
        initialized={auth.initialized}
        onDone={(expires) => {
          setAuth({ initialized: true, authenticated: true, expires });
          accountData.refresh();
        }}
      />
    );
  let page;
  const entering = !auth || (!accountData.data && !accountData.error);
  if (entering) {
    const current = nav.find((n) => n.path === path)!;
    page = (
      <div className="entry-content" aria-busy={!authError}>
        <div className="page-heading">
          <div>
            <h1>
              <current.icon size={23} />
              {current.label}
            </h1>
          </div>
        </div>
        {authError && (
          <ErrorBox message={authError} retry={() => location.reload()} />
        )}
      </div>
    );
  } else if (path === "/launch") page = <Launch />;
  else if (path === "/ips") page = <StaticIps />;
  else if (path === "/firewall") page = <Firewall />;
  else if (path === "/traffic") page = <TrafficPage />;
  else if (path === "/audit") page = <Audit />;
  else if (path === "/settings")
    page = (
      <Settings
        expires={auth?.expires}
        onSessionSaved={(expires) =>
          setAuth((a) => (a ? { ...a, expires } : a))
        }
      />
    );
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
        openAccounts: () => navigate("/settings"),
        demo,
      }}
    >
      <div className="shell">
        <Sidebar open={mobile} onOpenChange={setMobile} id="panel-navigation">
          <a
            className="brand"
            href={"/instances" + (demo ? "?demo=1" : "")}
            onClick={(e) => {
              e.preventDefault();
              navigate("/instances");
            }}
          >
            <Cloud size={21} />
            <strong>LightSail Panel</strong>
          </a>
          <button
            className="icon-button sidebar-close"
            aria-label="关闭导航"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
          <nav className="side-nav" aria-label="主导航">
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
          </nav>
          <div className="side-appearance">
            <ThemeControl compact />
          </div>
        </Sidebar>
        <div className="workspace">
          <header className="topbar">
            <div className="topbar-left">
              <button
                className="icon-button mobile-menu"
                aria-label="打开导航"
                aria-expanded={mobile}
                aria-controls="panel-navigation"
                onClick={() => setMobile(true)}
              >
                <Menu size={20} />
              </button>
              <nav className="breadcrumb" aria-label="当前位置">
                <span>控制台</span>
                <ChevronRight size={12} />
                <strong>{nav.find((n) => n.path === path)?.label}</strong>
              </nav>
            </div>
            <div className="top-right">
              {demo && (
                <span
                  className="demo-indicator"
                  title="所有数据和操作均为本地示例"
                >
                  演示模式
                </span>
              )}
              {demo ? (
                <a className="demo-exit" href="/">
                  退出演示 <ArrowUpRight size={13} />
                </a>
              ) : (
                <button
                  disabled={entering}
                  className="icon-button topbar-logout"
                  aria-label="退出登录"
                  title="退出登录"
                  onClick={async () => {
                    await api("/logout", {});
                    location.reload();
                  }}
                >
                  <LogOut size={18} />
                </button>
              )}
            </div>
          </header>
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
