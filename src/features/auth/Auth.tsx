import { ArrowUpRight, Cloud, FlaskConical } from "lucide-react";
import { useState } from "react";
import { ThemeControl } from "../../app/theme";
import { ErrorBox, Field, PendingButton } from "../../components/ui";
import { api, setCsrf } from "../../lib/api";
import { Form } from "../../components/ui/Form";
import { Input } from "../../components/ui/Input";
import SessionDuration from "./SessionDuration";

export default function Auth({
  initialized,
  onDone,
}: {
  initialized: boolean;
  onDone: (expires: number) => void;
}) {
  const [password, setPassword] = useState("");
  const [hours, setHours] = useState(720);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <Cloud size={27} />
          <strong>LightSail Panel</strong>
        </div>
        <h1>{initialized ? "登录" : "初始化"}</h1>
        <Form
          allowPasswordManager
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            if (!initialized && password !== confirm) {
              setError("两次输入的密码不一致");
              return;
            }
            setBusy(true);
            try {
              const result = await api(initialized ? "/login" : "/setup", {
                password,
                sessionHours: hours,
              });
              setCsrf(result.csrf);
              onDone(result.expires);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="管理员密码">
            <Input
              allowPasswordManager
              disabled={busy}
              data-pending={busy || undefined}
              type="password"
              name="password"
              placeholder={initialized ? undefined : "至少 12 位"}
              required
              autoComplete={initialized ? "current-password" : "new-password"}
              minLength={initialized ? 1 : 12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {!initialized && (
            <Field label="确认密码">
              <Input
                allowPasswordManager
                disabled={busy}
                data-pending={busy || undefined}
                type="password"
                name="password-confirmation"
                required
                minLength={12}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
          )}
          <SessionDuration hours={hours} onChange={setHours} disabled={busy} />
          {error && <ErrorBox message={error} />}
          <PendingButton
            type="submit"
            className="button primary full"
            busy={busy}
            pendingLabel={initialized ? "正在登录" : "正在初始化"}
          >
            {initialized ? "登录" : "初始化面板"}
          </PendingButton>
        </Form>
        <a className="demo-entry" href="/instances?demo=1">
          <FlaskConical size={15} />
          先预览演示面板
          <ArrowUpRight size={14} />
        </a>
        <ThemeControl />
      </div>
    </div>
  );
}
