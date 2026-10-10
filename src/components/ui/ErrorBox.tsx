import { ArrowRight, X } from "lucide-react";
export function ErrorBox({
  message,
  retry,
  dismiss,
}: {
  message: string;
  retry?: () => void;
  dismiss?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {retry && (
        <button onClick={retry}>
          重试 <ArrowRight size={13} />
        </button>
      )}
      {dismiss && (
        <button
          type="button"
          className="icon-button"
          aria-label="关闭错误提示"
          onClick={dismiss}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
