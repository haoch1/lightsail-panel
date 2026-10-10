import { ScrollText } from "lucide-react";
import type { AuditEntry } from "../../../shared/types";
import { useApi } from "../../app/context";
import { Busy, ErrorBox, RefreshButton } from "../../components/ui";

export default function Audit() {
  const { data, error, loading, refresh } = useApi<{ items: AuditEntry[] }>(
    "/audit",
  );
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
        <RefreshButton loading={loading} onClick={refresh} />
      </div>
      {error && <ErrorBox message={error} retry={refresh} />}
      <div className="table-wrap">
        <table>
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
                <td>{new Date(x.at).toLocaleString("zh-CN")}</td>
                <td>
                  {x.action === "ssh-connect" ? "SSH 终端连接" : x.action}
                </td>
                <td className="mono">{x.target || "—"}</td>
                <td>
                  <span
                    className={
                      "state " + (x.status === "success" ? "green" : "red")
                    }
                  >
                    {x.status === "success" ? "成功" : "失败"}
                  </span>
                </td>
                <td className="detail-cell">{x.detail || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && !data && <Busy />}
        {!loading && !data?.items.length && (
          <div className="empty">暂无操作记录</div>
        )}
      </div>
    </>
  );
}
