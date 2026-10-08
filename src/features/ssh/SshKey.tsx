import { regionLabel } from "../../../shared/regions";
import { Download } from "lucide-react";
import { useRef, useState } from "react";
import { usePanel } from "../../app/context";
import { api } from "../../lib/api";

export function DefaultKeyDownload({
  accountId,
  region,
  onDownloaded,
}: {
  accountId: string;
  region: string;
  onDownloaded?: () => void;
}) {
  const { demo, toast } = usePanel();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function download() {
    if (pending.current || demo || !accountId) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await api<{ filename: string; privateKey: string }>(
        "/ssh/default-key",
        { accountId, region },
      );
      const url = URL.createObjectURL(
        new Blob([result.privateKey], { type: "application/x-pem-file" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("已下载默认 SSH 私钥，请保存 .pem 文件");
      onDownloaded?.();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="ssh-download">
      <button
        type="button"
        className="button small"
        disabled={demo || busy || !accountId}
        onClick={download}
        aria-busy={busy}
      >
        <Download size={14} />
        {busy ? "正在下载…" : "下载默认私钥 (.pem)"}
      </button>
      <p className="muted">
        {demo
          ? "演示模式不提供真实私钥；连接 AWS 后可下载。"
          : `${regionLabel(region)}；若尚无默认密钥，AWS 会创建一个。`}
      </p>
    </div>
  );
}
