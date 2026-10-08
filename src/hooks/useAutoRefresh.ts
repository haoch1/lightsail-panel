import { useEffect, useRef } from "react";
import { scheduleAutoRefresh } from "../lib/auto-refresh";

/** Refresh only when cached data is due, pausing AWS polling in background tabs. */
export function useAutoRefresh(refresh: () => void, deadline?: number) {
  const callback = useRef(refresh);
  callback.current = refresh;
  useEffect(() => {
    if (!deadline) return;
    return scheduleAutoRefresh(deadline, () => callback.current());
  }, [deadline]);
}
