import { Bell, Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import type {
  NotificationRecord,
  NotificationSettings,
  NotificationType,
} from "../../../shared/notifications";
import {
  notificationChoices,
  formatNotification,
  notificationIcon,
  notificationExamples,
  notificationStatus,
} from "../../../shared/notifications";
import { useApi, usePanel } from "../../app/context";
import {
  Checkbox,
  Empty,
  ErrorBox,
  Field,
  PendingButton,
  TableLoading,
  when,
} from "../../components/ui";
import { Input } from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import TimePicker from "../../components/ui/TimePicker";
import { api } from "../../lib/api";
import Accounts from "../accounts/Accounts";
import SessionSettings from "../auth/SessionSettings";

const timezones = ["UTC", ...Intl.supportedValuesOf("timeZone")];
export default function Settings({
  expires,
  onSessionSaved,
}: {
  expires?: number;
  onSessionSaved: (expires: number) => void;
}) {
  const { toast, demo } = usePanel();
  const settings = useApi<{ notifications: NotificationSettings }>("/settings");
  const history = useApi<{ items: NotificationRecord[] }>("/notifications");
  const [draft, setDraft] = useState<NotificationSettings>();
  const [clearToken, setClearToken] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "">("");
  const [error, setError] = useState("");
  const [example, setExample] = useState<NotificationType>("traffic-stop");
  const [exampleAt] = useState(() => new Date().toISOString());
  const n = draft ?? settings.data?.notifications;
  const change = (patch: Partial<NotificationSettings>) => {
    if (!n) return;
    setDraft({ ...n, ...patch });
    setDirty(true);
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!n || busy) return;
    setBusy("save");
    setError("");
    try {
      const { telegramConfigured: _, ...input } = n;
      const result = await api<{ notifications: NotificationSettings }>(
        "/settings",
        { notifications: { ...input, clearToken } },
        "PUT",
      );
      setDraft(result.notifications);
      setClearToken(false);
      setDirty(false);
      toast("通知设置已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="settings-page">
      <div className="page-heading">
        <h1>
          <SettingsIcon size={23} />
          设置
        </h1>
      </div>
      <section
        className="form-panel settings-accounts"
        aria-label="AWS 账户管理"
      >
        <Accounts embedded />
      </section>
      <SessionSettings expires={expires} onSaved={onSessionSaved} />
      <section
        className="form-panel notification-settings"
        aria-labelledby="telegram-heading"
      >
        <div className="section-heading">
          <h2 id="telegram-heading">
            <Bell size={18} />
            Telegram 通知
          </h2>
          {n && (
            <Checkbox
              checked={n.telegramEnabled}
              disabled={!!busy}
              onChange={(e) => change({ telegramEnabled: e.target.checked })}
            >
              启用通知
            </Checkbox>
          )}
        </div>
        {settings.error && (
          <ErrorBox message={settings.error} retry={settings.refresh} />
        )}
        {!n ? (
          <div className="settings-loading" role="status">
            正在读取通知设置…
          </div>
        ) : (
          <form onSubmit={save}>
            <div className="form-grid">
              <Field label="Bot Token">
                <Input
                  type="password"
                  autoComplete="off"
                  disabled={!!busy || clearToken}
                  value={n.telegramToken}
                  placeholder={
                    demo
                      ? "演示模式，请勿输入真实 Token"
                      : n.telegramConfigured
                        ? "已配置，留空保留"
                        : "输入 Bot Token"
                  }
                  onChange={(e) => change({ telegramToken: e.target.value })}
                />
              </Field>
              <Field label="Chat ID">
                <Input
                  value={n.telegramChatId}
                  disabled={!!busy}
                  onChange={(e) => change({ telegramChatId: e.target.value })}
                  placeholder="用户、群组 ID 或 @频道用户名"
                />
              </Field>
            </div>
            {n.telegramConfigured && (
              <Checkbox
                disabled={!!busy}
                checked={clearToken}
                onChange={(e) => {
                  setClearToken(e.target.checked);
                  change({ telegramToken: "" });
                }}
              >
                清除已保存的 Token
              </Checkbox>
            )}
            <Field label="Telegram API 地址">
              <Input
                type="url"
                required
                value={n.apiBase}
                disabled={!!busy}
                onChange={(e) => change({ apiBase: e.target.value })}
              />
            </Field>
            <fieldset className="notification-types" disabled={!!busy}>
              <legend>
                <span>通知类型</span>
                <span className="notification-selection-actions">
                  <button
                    type="button"
                    className="button small"
                    disabled={
                      !!busy || n.events.length === notificationChoices.length
                    }
                    onClick={() =>
                      change({
                        events: notificationChoices.map((v) => v.value),
                      })
                    }
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="button small"
                    disabled={!!busy || !n.events.length}
                    onClick={() => change({ events: [] })}
                  >
                    取消全选
                  </button>
                </span>
              </legend>
              <div className="notification-type-grid">
                {notificationChoices.map((v) => (
                  <div key={v.value} title={v.hint}>
                    <Checkbox
                      disabled={!!busy}
                      checked={n.events.includes(v.value)}
                      onChange={(e) =>
                        change({
                          events: e.target.checked
                            ? [...n.events, v.value]
                            : n.events.filter((type) => type !== v.value),
                        })
                      }
                    >
                      {v.label}
                    </Checkbox>
                  </div>
                ))}
              </div>
            </fieldset>
            {n.events.includes("daily") && (
              <div className="form-grid notification-report-settings">
                <Field label="日报时间">
                  <TimePicker
                    value={n.reportTime}
                    disabled={!!busy}
                    onChange={(reportTime) => change({ reportTime })}
                  />
                </Field>
                <Field label="日报时区">
                  <Select
                    searchable
                    aria-label="日报时区"
                    value={n.timezone}
                    disabled={!!busy}
                    onChange={(e) => change({ timezone: e.target.value })}
                  >
                    {[...new Set([n.timezone, ...timezones])].map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
            <div className="notification-preview">
              <div className="section-heading">
                <h3>通知示例</h3>
                <Select
                  aria-label="通知示例类型"
                  value={example}
                  onChange={(e) =>
                    setExample(e.target.value as NotificationType)
                  }
                >
                  {notificationChoices.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div
                className="notification-example"
                dangerouslySetInnerHTML={{
                  __html: formatNotification(
                    {
                      ...notificationExamples[example],
                      type: example,
                      at: exampleAt,
                    },
                    true,
                    n.timezone,
                  ),
                }}
              />
            </div>
            {error && <ErrorBox message={error} />}
            <div className="settings-form-actions">
              <PendingButton
                type="button"
                className="button"
                busy={busy === "test"}
                pendingLabel="正在提交…"
                disabled={
                  !!busy || dirty || !n.telegramEnabled || !n.telegramConfigured
                }
                title={
                  dirty
                    ? "先保存修改，再测试已保存的配置"
                    : "使用已保存的 Telegram 配置"
                }
                onClick={async () => {
                  if (busy) return;
                  setBusy("test");
                  setError("");
                  try {
                    await api("/notifications/test", {});
                    toast(
                      demo
                        ? "演示测试已完成，未发送 Telegram 消息"
                        : "测试通知已加入发送队列",
                    );
                    history.refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                测试通知
              </PendingButton>
              <PendingButton
                type="submit"
                className="button primary"
                busy={busy === "save"}
                disabled={!!busy}
                pendingLabel="正在保存…"
              >
                保存
              </PendingButton>
            </div>
          </form>
        )}
      </section>
      <section
        className="form-panel notification-history"
        aria-labelledby="notifications-heading"
      >
        <div className="section-heading">
          <h2 id="notifications-heading">最近通知</h2>
        </div>
        {history.error && (
          <ErrorBox message={history.error} retry={history.refresh} />
        )}
        <div className="table-wrap">
          <table className="responsive-table notification-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>通知</th>
                <th>投递状态</th>
              </tr>
            </thead>
            <tbody>
              {history.loading && !history.data && (
                <TableLoading columns={["时间", "通知", "投递状态"]} />
              )}
              {history.data?.items.map((item) => (
                <tr key={item.id}>
                  <td data-label="时间">{when(item.at)}</td>
                  <td data-label="通知">
                    <div className="notification-title">
                      {notificationIcon(item)} {item.title}
                    </div>
                    {item.message && (
                      <p className="notification-message">{item.message}</p>
                    )}
                    {item.error && (
                      <div className="subline danger-text">{item.error}</div>
                    )}
                  </td>
                  <td data-label="投递状态">
                    <span className={`notification-status ${item.status}`}>
                      {notificationStatus[item.status]}
                    </span>
                    {(item.status === "queued" || item.status === "failed") &&
                      item.attempts > 0 && (
                        <div className="subline">已尝试 {item.attempts} 次</div>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!history.loading &&
            !history.error &&
            !history.data?.items.length && <Empty title="暂无通知记录" />}
        </div>
      </section>
    </div>
  );
}
