import { Cloud } from "lucide-react";
import type { ReactNode } from "react";
export function Empty({
  title = "暂无资源",
  description,
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
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
