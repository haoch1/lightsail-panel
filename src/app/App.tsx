import { Sidebar } from "../components/ui/Sidebar";
import { usePasswordManagerPolicy } from "../components/ui/usePasswordManagerPolicy";
import { awsRegionOptions } from "../../shared/regions";
import {
  ArrowDownUp,
  ArrowUpRight,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CirclePlus,
  FileText,
  Globe,
  LogOut,
  Menu,
  Server,
  Shield,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { BrandMark } from "../components/ui/BrandMark";
import { lazy, Suspense, useEffect, useState } from "react";
import type { Account, Region, ToastFn } from "../../shared/types";
import { ErrorBox } from "../components/ui";
import Audit from "../features/audit/Audit";
import Auth from "../features/auth/Auth";
import Instances from "../features/instances/Instances";
import { api, isDemo, setCsrf } from "../lib/api";
import { PanelContext, useApi } from "./context";
import { ThemeControl } from "./theme";
import { useResourceUpdates } from "../hooks/useResourceUpdates";
import { bootstrap } from "../lib/bootstrap";
import PageLoading from "../components/ui/PageLoading";
const Settings = lazy(() => import("../features/settings/Settings"));
const Firewall = lazy(() => import("../features/firewall/Firewall"));
const Launch = lazy(() => import("../features/launch/Launch"));
const TrafficPage = lazy(() => import("../features/monitoring/TrafficPage"));
const StaticIps = lazy(() => import("../features/networking/StaticIps"));

const nav = [
  { path: "/instances", label: "实例管理", icon: Server },
  { path: "/launch", label: "创建实例", icon: CirclePlus },
  { path: "/ips", label: "静态 IP", icon: Globe },
  { path: "/firewall", label: "防火墙", icon: Shield },
  { path: "/traffic", label: "流量统计", icon: ArrowDownUp },
  { path: "/audit", label: "操作日志", icon: FileText },
  { path: "/settings", label: "系统设置", icon: SlidersHorizontal },
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
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  useResourceUpdates(!!auth?.authenticated && !loggingOut, demo);
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
  const current = nav.find((n) => n.path === path)!;
  const placeholder = (
    <PageLoading
      path={path}
      title={current.label}
      icon={<current.icon size={20} />}
    />
  );
  if (entering) {
    page = authError ? (
      <ErrorBox message={authError} retry={() => location.reload()} />
    ) : (
      placeholder
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
            <BrandMark variant="lightsail" />
            <span className="brand-text">
              <strong>LightSail Panel</strong>
            </span>
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
                <n.icon size={16} />
                <span>{n.label}</span>
              </a>
            ))}
          </nav>
          <div className="side-appearance">
            <ThemeControl compact />
            {logoutError && (
              <div role="alert" className="error-box">
                {logoutError}
              </div>
            )}
            {!demo && (
              <button
                type="button"
                disabled={entering || loggingOut}
                aria-busy={loggingOut}
                className="sidebar-logout"
                onClick={async () => {
                  setLogoutError("");
                  setLoggingOut(true);
                  try {
                    await api("/logout", {});
                    location.reload();
                  } catch {
                    setLogoutError("未能确认退出，请检查网络后重试。");
                    setLoggingOut(false);
                  }
                }}
              >
                <LogOut size={15} />
                <span>
                  {loggingOut
                    ? "正在退出"
                    : logoutError
                      ? "重试退出"
                      : "退出登录"}
                </span>
              </button>
            )}
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
              <span className="mobile-page-title">
                {nav.find((n) => n.path === path)?.label}
              </span>
            </div>
            {demo && (
              <div className="top-right">
                <span
                  className="demo-indicator"
                  title="所有数据和操作均为本地示例"
                >
                  演示模式
                </span>
                <a className="demo-exit" href="/">
                  退出演示 <ArrowUpRight size={13} />
                </a>
              </div>
            )}
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
            <Suspense fallback={placeholder}>{page}</Suspense>
          </main>
        </div>
        <div className="toasts" aria-live="polite">
          {notices.map((n) => (
            <div key={n.id} className={"toast " + n.type}>
              {n.type === "error" ? (
                <CircleAlert size={17} />
              ) : (
                <CircleCheck size={17} />
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
