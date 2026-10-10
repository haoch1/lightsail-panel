import { ArrowUpRight, Cloud, FlaskConical, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ThemeControl } from "../../app/theme";
import { ErrorBox, Field, PendingButton } from "../../components/ui";
import { api, setCsrf } from "../../lib/api";
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
          <strong>Lightsail Panel</strong>
        </div>
        <h1>{initialized ? "登录面板" : "初始化你的面板"}</h1>
        <p>
          {initialized
            ? "使用管理员密码访问 Lightsail 控制台。"
            : "设置管理员密码，随后添加自己的 AWS 账户。"}
        </p>
        <form
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
          <Field
            label="管理员密码"
            help={initialized ? undefined : "至少 12 位，无默认密码。"}
          >
            <input
              disabled={busy}
              data-pending={busy || undefined}
              type="password"
              required
              autoComplete={initialized ? "current-password" : "new-password"}
              minLength={initialized ? 1 : 12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {!initialized && (
            <Field label="确认密码">
              <input
                disabled={busy}
                data-pending={busy || undefined}
                type="password"
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
            className="button primary full"
            busy={busy}
            pendingLabel="正在验证…"
          >
            {initialized ? "登录" : "创建管理员并进入"}
          </PendingButton>
        </form>
        <a className="demo-entry" href="/lightsail?demo=1">
          <FlaskConical size={15} />
          先预览演示面板
          <ArrowUpRight size={14} />
        </a>
        <div className="auth-foot">
          <ShieldCheck size={14} />
          凭证保存在你的服务器 · AES-256-GCM 加密
        </div>
        <ThemeControl />
      </div>
    </div>
  );
}
