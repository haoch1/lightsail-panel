import { ArrowRight } from "lucide-react";
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {retry && (
        <button onClick={retry}>
          重试 <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}
