import { Cloud } from "lucide-react";
import type { ReactNode } from "react";
export function Empty({
  title = "暂无资源",
  description = "当前账户和区域下没有相关资源。",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Cloud size={26} />
      </div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}
