export function State({ value }: { value: string }) {
  const names: Record<string, string> = {
    running: "运行中",
    stopped: "已停止",
    pending: "启动中",
    stopping: "停止中",
    "shutting-down": "终止中",
    terminated: "已终止",
    success: "成功",
    failed: "失败",
    Online: "在线",
  };
  return (
    <span
      className={
        "state " +
        (value === "running" || value === "success" || value === "Online"
          ? "green"
          : value === "pending" || value === "stopping"
            ? "amber"
            : value === "failed"
              ? "red"
              : "gray")
      }
    >
      <i />
      {names[value] || value || "—"}
    </span>
  );
}
