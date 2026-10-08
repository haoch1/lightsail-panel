import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { ToastFn } from "../../../shared/types";
export function CopyText({ text, toast }: { text?: string; toast: ToastFn }) {
  const [copied, setCopied] = useState(false);
  if (!text) return <span className="muted">—</span>;
  return (
    <button
      className="copy-text"
      title="点击复制"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast("复制失败，请手动选择并复制", "error");
        }
      }}
    >
      <span>{text}</span>
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
