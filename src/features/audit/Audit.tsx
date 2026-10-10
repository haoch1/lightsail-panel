import { ScrollText, Trash2 } from "lucide-react";
import { useState } from "react";
import { auditActionLabel } from "../../../shared/audit-actions";
import type { AuditEntry } from "../../../shared/types";
import { useApi, usePanel } from "../../app/context";
import {
  Busy,
  ErrorBox,
  Modal,
  PendingButton,
  RefreshButton,
} from "../../components/ui";
import { api } from "../../lib/api";

export default function Audit() {
  const { toast } = usePanel();
  const { data, error, loading, refresh } = useApi<{ items: AuditEntry[] }>(
    "/audit",
  );
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");

  async function clear() {
    if (clearing) return;
    setClearing(true);
    try {
      const { deleted } = await api<{ deleted: number }>(
        "/audit",
        undefined,
        "DELETE",
      );
      refresh();
      setConfirm(false);
      toast(`已清空 ${deleted} 条操作日志`);
    } catch (e) {
      setClearError((e as Error).message);
    } finally {
      setClearing(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            <ScrollText size={22} />
            操作日志
          </h1>
          <p>近期操作记录，最多显示 200 条</p>
        </div>
        <div className="row-actions">
          <RefreshButton loading={loading || clearing} onClick={refresh} />
          <button
            className="button danger"
            disabled={loading || clearing || !data?.items.length}
            onClick={() => {
              setClearError("");
              setConfirm(true);
            }}
          >
            <Trash2 size={15} />
            清空日志
          </button>
        </div>
      </div>
      {error && <ErrorBox message={error} retry={refresh} />}
      <div className="table-wrap">
        <table className="responsive-table audit-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作</th>
              <th>目标资源</th>
              <th>结果</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((x) => (
              <tr key={x.id}>
                <td data-label="时间">
                  {new Date(x.at).toLocaleString("zh-CN")}
                </td>
                <td data-label="操作">{auditActionLabel(x.action)}</td>
                <td data-label="目标资源" className="mono">
                  {x.target || "—"}
                </td>
                <td data-label="结果">
                  <span
                    className={
                      "state " +
                      (x.status === "success"
                        ? "green"
                        : x.status === "submitted"
                          ? ""
                          : "red")
                    }
                  >
                    {x.status === "success"
                      ? "成功"
                      : x.status === "submitted"
                        ? "处理中"
                        : "失败"}
                  </span>
                </td>
                <td data-label="详情" className="detail-cell">
                  {x.detail || "该历史记录未保存执行详情"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && !data && <Busy />}
        {!loading && !data?.items.length && (
          <div className="empty">暂无操作记录</div>
        )}
      </div>
      {confirm && (
        <Modal
          title="清空操作日志"
          busy={clearing}
          onClose={() => setConfirm(false)}
        >
          <p>清空全部已存储的操作日志，包括未显示的记录。删除后不可恢复。</p>
          {clearError && <ErrorBox message={clearError} />}
          <div className="modal-actions">
            <button
              className="button"
              disabled={clearing}
              onClick={() => setConfirm(false)}
            >
              取消
            </button>
            <PendingButton
              className="button danger"
              busy={clearing}
              pendingLabel="正在清空日志…"
              onClick={clear}
            >
              确认清空
            </PendingButton>
          </div>
        </Modal>
      )}
    </>
  );
}
