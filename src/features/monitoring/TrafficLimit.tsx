import { useState } from "react";
import type { Instance, TrafficLimitRule } from "../../../shared/types";
import { regionLabel } from "../../../shared/regions";
import { useApi, usePanel } from "../../app/context";
import {
  Busy,
  Checkbox,
  ErrorBox,
  Field,
  Modal,
  PendingButton,
  targetOf,
} from "../../components/ui";
import TrafficProgress from "../../components/TrafficProgress";
import {
  useInstanceUsage,
  type InstanceUsage,
} from "../../hooks/useInstanceUsage";
import { instanceKey } from "../../lib/instance-usage";
import { api, query } from "../../lib/api";
import { resourceCache } from "../../lib/resource-cache";

const labels: Record<string, string> = {
  disabled: "未启用",
  waiting: "等待检查",
  monitoring: "监测中",
  stopping: "正在关机",
  stopped: "实例已停止",
  paused: "已暂停",
  uncertain: "待核对停止结果",
  error: "检查失败",
};

export default function TrafficLimit({
  instance,
  initialUsage,
  onClose,
}: {
  instance: Instance;
  initialUsage?: InstanceUsage;
  onClose: () => void;
}) {
  const path = "/traffic-limit?" + query(targetOf(instance));
  const { data, error, loading, refresh } = useApi<{
    rule: TrafficLimitRule | null;
  }>(path);
  const usage = useInstanceUsage([instance]);
  const currentUsage = {
    ...initialUsage,
    ...usage.values[instanceKey(instance)],
  };
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="自动关机"
      className="traffic-limit-modal"
      description={instance.name + " · " + regionLabel(instance.region)}
      onClose={onClose}
      busy={busy}
    >
      <div className="traffic-limit-usage">
        <TrafficProgress usage={currentUsage} />
      </div>
      {loading && !data ? <Busy /> : null}
      {error && !data ? <ErrorBox message={error} retry={refresh} /> : null}
      {data ? (
        <TrafficLimitForm
          key={path}
          instance={instance}
          rule={data.rule}
          path={path}
          busy={busy}
          setBusy={setBusy}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}

function TrafficLimitForm({
  instance,
  rule,
  path,
  busy,
  setBusy,
  onClose,
}: {
  instance: Instance;
  rule: TrafficLimitRule | null;
  path: string;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onClose: () => void;
}) {
  const { toast, demo } = usePanel();
  const [enabled, setEnabled] = useState(rule?.enabled || false);
  const [percent, setPercent] = useState(rule?.thresholdPercent || 90);
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          await api("/traffic-limit", {
            ...targetOf(instance),
            enabled,
            thresholdPercent: percent,
            utcOffsetMinutes: -new Date().getTimezoneOffset(),
          });
          resourceCache.invalidate((key) => key === path);
          toast(enabled ? "已启用自动关机" : "已关闭自动关机");
          onClose();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Checkbox
        checked={enabled}
        pending={busy}
        onChange={(e) => setEnabled(e.target.checked)}
        description="按本月入站＋出站合计计算，达到阈值后停止此实例。"
      >
        启用自动关机
      </Checkbox>
      <Field
        label="套餐流量阈值（%）"
        help="相对于此实例当前套餐的月流量额度，支持 0.1–100%。"
      >
        <input
          type="number"
          required
          min={0.1}
          max={100}
          step={0.1}
          value={Number.isFinite(percent) ? percent : ""}
          disabled={busy || !enabled}
          data-pending={(busy && enabled) || undefined}
          onChange={(e) => setPercent(e.target.valueAsNumber)}
        />
      </Field>
      <div className="notice">
        <span>
          每 5 分钟后台检查。
          {demo ? "演示设置不会调用 AWS。" : "关闭浏览器后继续执行。"}
          AWS 指标可能延迟；停止后套餐仍会计费，下月不会自动启动。
        </span>
      </div>
      {rule?.enabled &&
      (rule.detail ||
        ["stopping", "stopped", "paused", "uncertain", "error"].includes(
          rule.status,
        )) ? (
        <p className="muted" role="status">
          {rule.detail || labels[rule.status]}
        </p>
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
      <div className="modal-actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={onClose}
        >
          取消
        </button>
        <PendingButton busy={busy} pendingLabel="正在保存…">
          保存
        </PendingButton>
      </div>
    </form>
  );
}
