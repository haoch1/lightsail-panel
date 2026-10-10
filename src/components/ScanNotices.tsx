import type { ResourceScan } from "../../shared/types";
import { useEffect, useState } from "react";
import { ErrorBox } from "./ui";
import { scanNotices } from "../lib/scan-notices";

export default function ScanNotices({
  scan,
}: {
  scan?: ResourceScan<unknown>;
}) {
  const notices = scanNotices(scan?.errors);
  const keys = JSON.stringify(notices.map((notice) => notice.key));
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    const active = new Set<string>(JSON.parse(keys));
    setDismissed((current) => {
      const next = current.filter((key) => active.has(key));
      return next.length === current.length ? current : next;
    });
  }, [keys]);
  return (
    <>
      {notices
        .filter((notice) => !dismissed.includes(notice.key))
        .map((notice) => (
          <ErrorBox
            key={notice.key}
            message={notice.message}
            dismiss={() => setDismissed((current) => [...current, notice.key])}
          />
        ))}
    </>
  );
}
