import { LoaderCircle } from "lucide-react";
export function Busy({ text = "正在从 AWS 获取数据…" }: { text?: string }) {
  return (
    <div className="empty loading-state" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={25} />
      <p>{text}</p>
    </div>
  );
}
