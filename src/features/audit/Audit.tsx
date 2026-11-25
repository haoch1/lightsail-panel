import { FileText, Trash2 } from "lucide-react";
import { useState } from "react";
import { auditActionLabel } from "../../../shared/audit-actions";
import type { AuditPage } from "../../../shared/types";
import { useApi, usePanel } from "../../app/context";
import {
  TableLoading,
  ErrorBox,
  Modal,
  PendingButton,
} from "../../components/ui";
import { api } from "../../lib/api";

export default function Audit() {
  const { toast } = usePanel();
  const [page, setPage] = useState(0);
  const { data, error, loading, refresh } = useApi<AuditPage>(
    "/audit?page=" + page,
  );
  const lastPage = data
    ? Math.max(0, Math.ceil(data.total / data.size) - 1)
    : 0;
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
      if (page === 0) refresh();
      else setPage(0);
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
            <FileText size={20} />
            操作日志
          </h1>
        </div>
        <div className="row-actions">
          <button
            className="button danger-text"
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
            {loading && !data && (
              <TableLoading
                columns={["时间", "操作", "目标资源", "结果", "详情"]}
              />
            )}
            {data?.items.map((x) => (
              <tr className="resource-row" key={x.id}>
                <td data-label="时间">
                  {new Date(x.at).toLocaleString("zh-CN")}
                </td>
                <td data-label="操作">{auditActionLabel(x.action)}</td>
                <td data-label="目标资源">{x.target || "—"}</td>
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
        {!loading && !error && data && !data.items.length && (
          <div className="empty">暂无操作记录</div>
        )}
      </div>
      {data && data.total > 0 && (
        <nav className="row-actions" aria-label="日志分页">
          <span>
            第 {data.page + 1} / {lastPage + 1} 页，共 {data.total} 条
          </span>
          <button
            className="button small"
            disabled={data.page === 0}
            onClick={() => setPage(data.page - 1)}
          >
            上一页
          </button>
          <button
            className="button small"
            disabled={data.page >= lastPage}
            onClick={() => setPage(data.page + 1)}
          >
            下一页
          </button>
        </nav>
      )}
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
