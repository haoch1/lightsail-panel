import { X } from "lucide-react";
import { useState } from "react";
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
              job.instances.some((item) => item.name === instance.id)) &&
            (job.action === "launch" ||
              !job.action ||
              job.status !== "success") &&
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
                      ? "资源操作已完成"
                      : "实例创建及配置已完成"
                    : "操作未全部完成，请核对结果"}
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
