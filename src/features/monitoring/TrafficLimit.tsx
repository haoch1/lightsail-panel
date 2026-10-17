import { useState } from "react";
import type { Instance, TrafficLimitRule } from "../../../shared/types";
import { regionLabel } from "../../../shared/regions";
import { useApi, usePanel } from "../../app/context";
import {
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
      {loading && !data ? (
        <div
          className="traffic-limit-placeholder"
          role="status"
          aria-label="正在读取自动关机设置"
        >
          <div className="check-field">
            <div className="check-label">
              <span className="table-placeholder" />
            </div>
            <p className="check-description">达到本月流量阈值后停止实例。</p>
          </div>
          <Field label="套餐流量阈值（0.1–100%）">
            <div className="input-placeholder">
              <span className="table-placeholder" />
            </div>
          </Field>
          <TrafficLimitNotice />
          <div className="modal-actions">
            <button type="button" className="button" onClick={onClose}>
              取消
            </button>
            <button className="button primary" disabled>
              保存
            </button>
          </div>
        </div>
      ) : null}
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
  const { toast } = usePanel();
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
        description="达到本月流量阈值后停止实例。"
      >
        启用自动关机
      </Checkbox>
      <Field label="套餐流量阈值（0.1–100%）">
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
      <TrafficLimitNotice />
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

function TrafficLimitNotice() {
  const { demo } = usePanel();
  return (
    <div className="notice">
      <span>
        后台每 5 分钟检查，AWS 指标可能延迟。
        {demo && "演示设置不调用 AWS。"}
        停止后套餐仍计费，下月不自动启动。
      </span>
    </div>
  );
}
