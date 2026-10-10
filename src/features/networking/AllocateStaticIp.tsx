import { regionLabel } from "../../../shared/regions";
import { useState } from "react";
import type { Region } from "../../../shared/types";
import { useApi, usePanel } from "../../app/context";
import { ErrorBox, Field, Modal, PendingButton } from "../../components/ui";
import Select from "../../components/ui/Select";
import { api, query } from "../../lib/api";

export default function AllocateStaticIp({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const panel = usePanel();
  const initialAccount = panel.accountId === "all" ? "" : panel.accountId;
  const [accountId, setAccountId] = useState(initialAccount);
  const [region, setRegion] = useState(
    initialAccount && panel.region !== "all" ? panel.region : "",
  );
  const [name, setName] = useState(() => "panel-" + Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const regions = useApi<{ items: Region[] }>(
    accountId ? "/regions?" + query({ accountId, service: "lightsail" }) : null,
  );
  const validRegion = regions.data?.items.some((r) => r.id === region);

  async function allocate() {
    if (busy || !accountId || !validRegion) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/static-ips", {
        accountId,
        region,
        name,
        action: "allocate",
      });
      panel.toast(result.notice || "静态 IP 分配已提交");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="分配静态 IP" busy={busy} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void allocate();
        }}
      >
        <div className="form-grid">
          <Field label="AWS 账户">
            <Select
              required
              disabled={busy}
              aria-label="分配账户"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setRegion("");
                setError("");
              }}
            >
              <option value="">选择账户</option>
              {panel.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.awsAccountId}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="区域">
            <Select
              required
              disabled={busy || !accountId || regions.loading}
              aria-label="分配区域"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              <option value="">
                {!accountId
                  ? "先选择账户"
                  : regions.loading
                    ? "加载区域…"
                    : "选择区域"}
              </option>
              {regions.data?.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {regionLabel(r.id)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {regions.error && (
          <ErrorBox message={regions.error} retry={regions.refresh} />
        )}
        <Field label="静态 IP 名称">
          <input
            required
            disabled={busy}
            aria-label="静态 IP 名称"
            minLength={2}
            maxLength={63}
            pattern={"[a-zA-Z0-9_][a-zA-Z0-9_\\-]*[a-zA-Z0-9_]"}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="notice">
          静态 IP 属于所选账户和区域，只能绑定同一区域的 Lightsail 实例。
        </div>
        {error && <ErrorBox message={error} />}
        <div className="modal-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <PendingButton
            className="button primary"
            busy={busy}
            pendingLabel="正在分配…"
            disabled={!accountId || !validRegion}
          >
            确认分配
          </PendingButton>
        </div>
      </form>
    </Modal>
  );
}
