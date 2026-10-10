import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useOperationJobs } from "../../hooks/useResourceUpdates";
import { usePanel } from "../../app/context";
import type { Instance } from "../../../shared/types";

const stages: Record<string, string> = {
  instance: "等待实例就绪",
  firewall: "设置防火墙",
  allocate: "分配静态 IP",
  attach: "绑定静态 IP",
  verify: "确认绑定结果",
  finish: "确认防火墙结果",
  done: "已完成",
  failed: "处理失败",
  observe: "等待 AWS 状态更新",
};
export default function LaunchNetworkStatus({
  resource = "instances",
  instance,
}: {
  resource?: string;
  instance?: Instance;
}) {
  const panel = usePanel();
  const jobs = useOperationJobs();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const expire = () => {
      const current = Date.now();
      setNow(current);
      const expires = jobs
        .filter((job) => job.status === "success" && job.completedAt)
        .map((job) => job.completedAt! + 8000)
        .filter((at) => at > current);
      if (expires.length)
        timer = setTimeout(expire, Math.min(...expires) - current + 1);
    };
    expire();
    return () => clearTimeout(timer);
  }, [jobs]);
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("panel:launch-network-dismissed") || "[]",
      );
      return Array.isArray(saved)
        ? saved.filter((item) => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  });
  return (
    <>
      {jobs
        .filter(
          (job) =>
            !dismissed.includes(job.id) &&
            (!job.resources || job.resources.includes(resource)) &&
            (!instance ||
              job.targetInstance === instance.id ||
              job.instances.some((item) => item.name === instance.id)) &&
            (job.status !== "success" ||
              (!!job.completedAt && job.completedAt + 8000 > now)) &&
            (job.status !== "success" ||
              !jobs.some(
                (other) =>
                  (other.at || 0) > (job.at || 0) &&
                  other.accountId === job.accountId &&
                  other.region === job.region &&
                  other.resources?.includes(resource) &&
                  other.instances.some((item) =>
                    job.instances.some(
                      (previous) => previous.name === item.name,
                    ),
                  ),
              )) &&
            ((instance?.accountId || panel.accountId) === "all" ||
              (instance?.accountId || panel.accountId) === job.accountId) &&
            ((instance?.region || panel.region) === "all" ||
              (instance?.region || panel.region) === job.region),
        )
        .map((job) => (
          <div
            className={
              job.status === "failed"
                ? "error-box launch-network-status"
                : "notice launch-network-status"
            }
            key={job.id}
            role="status"
          >
            <div>
              <strong>
                {job.status === "pending"
                  ? job.action && job.action !== "launch"
                    ? "操作已提交，正在跟踪资源状态"
                    : "实例已提交，等待创建及配置完成"
                  : job.status === "success"
                    ? job.action && job.action !== "launch"
                      ? resource === "ports"
                        ? "防火墙规则已更新"
                        : "资源操作已完成"
                      : "实例创建及配置已完成"
                    : "资源操作失败"}
              </strong>
              {job.instances.map((item) => (
                <div key={item.name}>
                  {item.name} ·{" "}
                  {item.detail || stages[item.stage] || item.stage}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭进度提示"
              onClick={() => {
                const next = [...dismissed, job.id];
                setDismissed(next);
                try {
                  sessionStorage.setItem(
                    "panel:launch-network-dismissed",
                    JSON.stringify(next),
                  );
                } catch {}
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
    </>
  );
}
