export const notificationChoices = [
  {
    value: "operation-success",
    label: "资源操作成功",
    hint: "实例、防火墙及静态 IP 操作确认完成后发送",
  },
  {
    value: "operation-failed",
    label: "资源操作失败",
    hint: "操作失败或结果确认超时时发送",
  },
  {
    value: "traffic-stop",
    label: "流量保护关机",
    hint: "达到已配置阈值后的关机结果",
  },
  {
    value: "status",
    label: "实例状态变化",
    hint: "后台检测到实例运行状态发生变化",
  },
  {
    value: "ip",
    label: "公网 IP 变化",
    hint: "后台检测到 IPv4 或 IPv6 地址变化",
  },
  {
    value: "monitor-error",
    label: "监控异常",
    hint: "实例或流量查询异常；持续异常不重复发送",
  },
  {
    value: "monitor-recovery",
    label: "监控恢复",
    hint: "此前异常的查询恢复成功",
  },
  {
    value: "daily",
    label: "每日汇总",
    hint: "使用后台最近采集的数据，不增加 AWS 查询",
  },
] as const;
export type NotificationType = (typeof notificationChoices)[number]["value"];
export interface NotificationSettings {
  telegramEnabled: boolean;
  telegramToken: string;
  telegramConfigured: boolean;
  telegramChatId: string;
  apiBase: string;
  events: NotificationType[];
  reportTime: string;
  timezone: string;
}
export const defaultNotifications: NotificationSettings = {
  telegramEnabled: false,
  telegramToken: "",
  telegramConfigured: false,
  telegramChatId: "",
  apiBase: "https://api.telegram.org",
  events: ["operation-failed", "traffic-stop", "ip", "daily"],
  reportTime: "09:00",
  timezone: "Asia/Shanghai",
};
export interface NotificationRecord {
  id: string;
  at: string;
  type: NotificationType | "test";
  title: string;
  message: string;
  status: "queued" | "sent" | "failed" | "skipped";
  attempts: number;
  error?: string;
  nextAt?: number;
  sentAt?: string;
  usage?: { used: number; total: number };
}
export const notificationStatus = {
  queued: "等待发送",
  sent: "已发送",
  failed: "发送失败",
  skipped: "已跳过",
};
export interface NotificationMessage {
  title: string;
  message?: string;
  type?: NotificationType | "test";
  at?: string | number;
  usage?: { used: number; total: number };
}
const clipMessage = (value: string, limit: number) =>
  Array.from(value).slice(0, limit).join("");
const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function notificationIcon(item: NotificationMessage) {
  if (
    item.type === "operation-failed" ||
    item.type === "monitor-error" ||
    /失败|异常|超时|错误/.test(item.title)
  )
    return "🔴";
  return item.type === "status" || item.type === "ip" ? "🟠" : "🟢";
}
/** The preview and the Telegram sender deliberately use the same safe formatter. */
export function formatNotification(
  item: NotificationMessage,
  html = false,
  timezone = "Asia/Shanghai",
) {
  const encode = (value: string) => (html ? escapeHtml(value) : value);
  const bold = (value: string) => (html ? `<b>${encode(value)}</b>` : value);
  const body: string[] = [];
  let message = item.message || "";
  if (item.type !== "daily") {
    const lines = message.split("\n");
    const field = (pattern: RegExp) =>
      lines
        .find((line) => pattern.test(line))
        ?.replace(pattern, "")
        .trim() || "";
    const name = field(/^(?:目标|实例)：/);
    if (name && name !== "—") body.push(bold(clipMessage(name, 48)));
    message = lines
      .filter((line) => !/^(?:目标|实例|账户|区域)：/.test(line))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const usage = item.usage;
    if (
      usage &&
      Number.isFinite(usage.used) &&
      usage.used >= 0 &&
      Number.isFinite(usage.total) &&
      usage.total > 0
    ) {
      body.push(
        "本月流量 " + bold(((usage.used / usage.total) * 100).toFixed(1) + "%"),
      );
      body.push(
        encode(
          `已用 ${(usage.used / 1024 ** 3).toFixed(1)} / ${(usage.total / 1024 ** 3).toFixed(1)} GB · 剩余 ${(Math.max(0, usage.total - usage.used) / 1024 ** 3).toFixed(1)} GB`,
        ),
      );
      message = message.replace(
        /本月入站＋出站达到 [\d.]+%，阈值 ([\d.]+)%[；;]?/,
        "阈值 $1%；",
      );
    }
  }
  if (message)
    body.push(encode(clipMessage(message, item.type === "daily" ? 2800 : 800)));
  const sections = [
    bold(notificationIcon(item) + " " + clipMessage(item.title, 80)),
  ];
  if (body.length)
    sections.push(
      html ? `<blockquote>${body.join("\n")}</blockquote>` : body.join("\n"),
    );
  if (item.at !== undefined && Number.isFinite(new Date(item.at).valueOf())) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(item.at))
        .map((p) => [p.type, p.value]),
    );
    sections.push(
      `🕒 ${parts.year}.${parts.month}.${parts.day} - ${parts.hour}:${parts.minute}:${parts.second}`,
    );
  }
  return sections.join("\n\n");
}
export const notificationExamples: Record<
  NotificationType,
  NotificationMessage
> = {
  "operation-success": {
    title: "开放防火墙端口成功",
    message: "实例：web-server\nTCP 443 · 0.0.0.0/0",
  },
  "operation-failed": {
    title: "停止实例失败",
    message: "实例：web-server\nAWS 拒绝请求，请检查 IAM 权限",
  },
  "traffic-stop": {
    title: "流量保护关机成功",
    message: "实例：web-server\n阈值 95%",
    usage: { used: 1902.4 * 1024 ** 3, total: 2000 * 1024 ** 3 },
  },
  status: {
    title: "实例状态变化",
    message: "实例：web-server\n运行中 → 已停止",
  },
  ip: {
    title: "公网 IP 变化",
    message: "实例：web-server\nIPv4：198.51.100.10 → 198.51.100.20",
  },
  "monitor-error": {
    title: "实例监控异常",
    message: "实例：web-server\nAWS 查询超时",
  },
  "monitor-recovery": {
    title: "实例监控恢复",
    message: "实例：web-server",
  },
  daily: {
    title: "LightSail 实例日报",
    message:
      "实例：2 · 运行中：1 · 已停止：1\n\nweb-server · 运行中\n本月流量 350.56 GB\n\nbackup-server · 已停止\n本月流量 12.30 GB",
  },
};
