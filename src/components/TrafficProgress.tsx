import type { InstanceUsage } from "../hooks/useInstanceUsage";
import { bytes } from "../lib/format";

const percentage = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

export default function TrafficProgress({
  usage,
  compact = false,
}: {
  usage?: InstanceUsage;
  compact?: boolean;
}) {
  const used = usage?.traffic;
  const allowance = usage?.allowance;
  const hasUsed = used != null && Number.isFinite(used) && used >= 0;
  const hasAllowance =
    allowance != null && Number.isFinite(allowance) && allowance > 0;
  const ratio =
    hasUsed && hasAllowance && !usage?.trafficError
      ? (used / allowance) * 100
      : undefined;
  const percent = ratio === undefined ? "—" : percentage.format(ratio) + "%";
  const usedLabel = hasUsed ? bytes(used) : used === undefined ? "…" : "—";
  const allowanceLabel = hasAllowance
    ? bytes(allowance).replace(".00 ", " ")
    : allowance === undefined
      ? "…"
      : "—";
  const tone =
    ratio !== undefined && ratio >= 100
      ? "danger"
      : ratio !== undefined && ratio >= 90
        ? "warning"
        : "normal";
  return (
    <span
      className={"traffic-progress" + (compact ? " compact" : "")}
      data-tone={tone}
    >
      <span className="traffic-progress-heading">
        <span>{compact ? usedLabel : "流量使用进度"}</span>
        <span className="traffic-progress-percent">{percent}</span>
      </span>
      {!compact ? (
        <span className="traffic-progress-amount">
          <strong>{usedLabel}</strong>
          <span>/ {allowanceLabel}</span>
        </span>
      ) : null}
      <span
        className="traffic-progress-track"
        role="progressbar"
        aria-label="本月流量使用比例"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ratio === undefined ? undefined : Math.min(100, ratio)}
        aria-valuetext={
          ratio === undefined
            ? usage?.trafficError
              ? "流量数据不完整"
              : "等待流量或套餐额度数据"
            : `已用 ${usedLabel}，套餐额度 ${allowanceLabel}，使用 ${percent}`
        }
      >
        <span
          className="traffic-progress-fill"
          style={{ width: `${Math.min(100, ratio ?? 0)}%` }}
        />
      </span>
      <span className="traffic-progress-caption">
        {compact ? `${allowanceLabel} / 月` : "本月入站＋出站 / 套餐月额度"}
        {usage?.trafficError ? <span> · 数据不完整</span> : null}
      </span>
    </span>
  );
}
