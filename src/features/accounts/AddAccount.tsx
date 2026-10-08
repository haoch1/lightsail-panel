import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { usePanel } from "../../app/context";
import { ErrorBox, Field } from "../../components/ui";
import { api } from "../../lib/api";

export default function AddAccount({
  onClose,
  onDone,
  busy,
  onBusyChange,
}: {
  onClose: () => void;
  onDone: () => void;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { toast, demo } = usePanel();
  const [form, setForm] = useState({
    name: "",
    accessKeyId: "",
    secretAccessKey: "",
  });
  const [error, setError] = useState("");
  function change(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  return (
    <form
      className="account-add-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        onBusyChange(true);
        setError("");
        try {
          await api("/accounts", form);
          toast(demo ? "示例账户已添加" : "AWS 账户验证通过并已保存");
          onDone();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          onBusyChange(false);
        }
      }}
    >
      <Field label="账户名称">
        <input
          aria-label="账户名称"
          required
          maxLength={80}
          value={form.name}
          onChange={(e) => change("name", e.target.value)}
        />
      </Field>
      {!demo && (
        <>
          <Field label="Access Key ID">
            <input
              autoComplete="off"
              required
              value={form.accessKeyId}
              onChange={(e) => change("accessKeyId", e.target.value)}
            />
          </Field>
          <Field label="Secret Access Key">
            <input
              type="password"
              autoComplete="new-password"
              name="aws-access-key-secret"
              required
              value={form.secretAccessKey}
              onChange={(e) => change("secretAccessKey", e.target.value)}
            />
          </Field>
        </>
      )}
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
        <button className="button primary" disabled={busy}>
          <ShieldCheck size={15} />
          {busy ? "正在验证 AWS…" : demo ? "添加示例账户" : "验证并保存"}
        </button>
      </div>
    </form>
  );
}
