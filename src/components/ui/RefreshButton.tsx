import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
export function RefreshButton({
  loading,
  onClick,
  text = "刷新",
  className = "",
}: {
  loading: boolean;
  onClick: () => void;
  text?: string;
  className?: string;
}) {
  const [turning, setTurning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`button refresh-button ${className}`.trim()}
      aria-disabled={loading || turning}
      aria-busy={loading}
      onClick={() => {
        if (loading || turning) return;
        setTurning(true);
        timer.current = setTimeout(() => setTurning(false), 1000);
        onClick();
      }}
    >
      <span className={turning ? "refresh-turn" : "refresh-icon"}>
        <RefreshCw size={15} />
      </span>
      {text}
      <span className="sr-only">{loading ? "，正在加载" : ""}</span>
    </button>
  );
}
