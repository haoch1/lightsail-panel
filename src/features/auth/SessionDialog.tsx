import { useState } from "react";
import { api } from "../../lib/api";
import { ErrorBox, Modal, PendingButton, when } from "../../components/ui";
import SessionDuration from "./SessionDuration";
export default function SessionDialog({
  expires,
  onSaved,
  onClose,
}: {
  expires?: number;
  onSaved: (expires: number) => void;
  onClose: () => void;
}) {
  const [hours, setHours] = useState(720);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="登录有效期"
      description={
        expires
          ? "当前登录到期时间：" + when(new Date(expires).toISOString())
          : undefined
      }
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            const result = await api<{ expires: number }>("/session", {
              hours,
            });
            onSaved(result.expires);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <SessionDuration hours={hours} onChange={setHours} disabled={busy} />
        <p className="muted">
          保存后更新当前浏览器的登录期限，其他浏览器的会话不受影响。退出登录会立即结束当前会话。
        </p>
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
          <PendingButton busy={busy} pendingLabel="正在保存…">
            保存
          </PendingButton>
        </div>
      </form>
    </Modal>
  );
}
