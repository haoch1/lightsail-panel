import { Form } from "../../components/ui/Form";
import { useState } from "react";
import { usePanel } from "../../app/context";
import { ErrorBox, PendingButton, when } from "../../components/ui";
import { api } from "../../lib/api";
import SessionDuration from "./SessionDuration";

export default function SessionSettings({
  expires,
  onSaved,
}: {
  expires?: number;
  onSaved: (expires: number) => void;
}) {
  const { toast } = usePanel();
  const [hours, setHours] = useState(720);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section
      className="form-panel session-settings"
      aria-labelledby="session-heading"
    >
      <div className="section-heading">
        <h2 id="session-heading">登录有效期</h2>
        {expires && (
          <span className="session-expiry">
            到期时间 {when(new Date(expires).toISOString())}
          </span>
        )}
      </div>
      <Form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const result = await api<{ expires: number }>("/session", {
              hours,
            });
            onSaved(result.expires);
            toast("登录有效期已更新");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="session-settings-row">
          <SessionDuration
            label="续期时长"
            hours={hours}
            onChange={setHours}
            disabled={busy}
          />
          <PendingButton
            className="button primary"
            type="submit"
            busy={busy}
            pendingLabel="正在保存…"
          >
            保存
          </PendingButton>
        </div>
        {error && <ErrorBox message={error} />}
      </Form>
    </section>
  );
}
