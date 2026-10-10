type RefreshEnvironment = {
  now: () => number;
  visible: () => boolean;
  setTimer: (callback: () => void, delay: number) => unknown;
  clearTimer: (timer: unknown) => void;
  onVisibility: (callback: () => void) => () => void;
};

/** One refresh per deadline. React subscribes again when new data has a new deadline. */
export function scheduleAutoRefresh(
  deadline: number,
  refresh: () => void,
  environment: RefreshEnvironment = {
    now: Date.now,
    visible: () => document.visibilityState !== "hidden",
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    onVisibility: (callback) => {
      document.addEventListener("visibilitychange", callback);
      return () => document.removeEventListener("visibilitychange", callback);
    },
  },
) {
  let timer: unknown;
  let fired = false;
  const schedule = () => {
    environment.clearTimer(timer);
    if (fired || !environment.visible()) return;
    timer = environment.setTimer(
      () => {
        if (!environment.visible()) return;
        fired = true;
        refresh();
      },
      Math.max(0, deadline - environment.now()),
    );
  };
  const unsubscribe = environment.onVisibility(schedule);
  schedule();
  return () => {
    environment.clearTimer(timer);
    unsubscribe();
  };
}
