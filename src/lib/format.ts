const decimal = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integer = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
export const number = (value: number) => decimal.format(value);
export const whole = (value: number) => integer.format(value);
export const money = (value: number) => usd.format(value);
export const moneyAxis = (value: number) => money(value).replace("US$", "$");
export const percent = (value: number) => `${decimal.format(value)}%`;
export const count = (value: number) => `${integer.format(value)} 次`;
export function duration(seconds: number) {
  return seconds >= 3600
    ? `${decimal.format(seconds / 3600)} 小时`
    : seconds >= 60
      ? `${decimal.format(seconds / 60)} 分钟`
      : `${decimal.format(seconds)} 秒`;
}
export function bytes(value = 0) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(
    4,
    Math.max(0, Math.floor(Math.log2(Math.max(1, Math.abs(value))) / 10)),
  );
  return `${decimal.format(value / 1024 ** index)} ${units[index]}`;
}
export function when(value?: string) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}
export function chartDate(value: string, mode: "date" | "time", full = false) {
  const date = new Date(value);
  if (mode === "date")
    return full ? value.slice(0, 10) : value.slice(5, 10).replace("-", "/");
  return date.toLocaleString("zh-CN", {
    ...(full ? { year: "numeric" as const } : {}),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
