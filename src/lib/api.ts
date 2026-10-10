import { resourceCache } from "./resource-cache";
import { matchesUpdate, mutationUpdate } from "../../shared/resource-update";
function changed(path: string, body: unknown) {
  if (path === "/session" || path === "/traffic-limit") return;
  const update = mutationUpdate(path, body);
  if (update) {
    resourceCache.invalidate((key) => matchesUpdate(key, update));
    window.dispatchEvent(
      new CustomEvent("panel:resources-updated", { detail: update }),
    );
  } else resourceCache.clear();
  window.dispatchEvent(new Event("panel:mutation"));
}
let csrf = "";
let demo = new URLSearchParams(location.search).get("demo") === "1";
function restoreSession(identity: string) {
  // Store resource metadata only, under a session fingerprint; never persist credentials or key downloads.
  let fingerprint = 0xcbf29ce484222325n;
  for (const char of identity)
    fingerprint = BigInt.asUintN(
      64,
      (fingerprint ^ BigInt(char.charCodeAt(0))) * 0x100000001b3n,
    );
  try {
    resourceCache.restore(
      sessionStorage,
      "panel:resources:v2:" + fingerprint.toString(16),
    );
  } catch {
    resourceCache.clear();
  }
}
if (demo) restoreSession("demo");
export const isDemo = () => demo;
export const setCsrf = (value: string) => {
  if (value !== csrf) {
    if (value) restoreSession(value);
    else resourceCache.clear();
  }
  csrf = value;
};
export const setDemo = (value: boolean) => {
  if (value !== demo) {
    resourceCache.clear();
    if (value) restoreSession("demo");
  }
  demo = value;
};
export function query(values: Record<string, unknown>) {
  return new URLSearchParams(
    Object.entries(values)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const requestMethod = method || (body === undefined ? "GET" : "POST");
  if (
    demo &&
    !path.startsWith("/auth") &&
    !path.startsWith("/setup") &&
    !path.startsWith("/login")
  ) {
    const { demoApi } = await import("../demo");
    const data = await demoApi(path, body, method);
    if (requestMethod !== "GET") changed(path, body);
    return data;
  }
  let result: Response;
  try {
    result = await fetch("/api" + path, {
      method: requestMethod,
      signal: AbortSignal.timeout(path.startsWith("/auth") ? 10000 : 120000),
      credentials: "same-origin",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    // The server may have accepted a mutation before the response was lost.
    if (requestMethod !== "GET" && mutationUpdate(path, body))
      changed(path, body);
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error(
        requestMethod === "GET"
          ? "连接超时，请检查面板服务和浏览器网络后重试。"
          : "请求超时，操作可能已经提交。请先刷新资源状态，再决定是否重试。",
      );
    }
    throw new Error(
      "无法连接面板服务，请检查本机服务和浏览器网络。" +
        (error instanceof Error ? `（${error.message}）` : ""),
    );
  }
  const data = await result
    .json()
    .catch(() => ({ error: "服务器返回了无效响应" }));
  if (!result.ok) {
    if (requestMethod !== "GET" && mutationUpdate(path, body))
      changed(path, body);
    if (result.status === 401 && !path.startsWith("/login")) {
      csrf = "";
      resourceCache.clear();
      window.dispatchEvent(new Event("panel:unauthorized"));
    }
    throw new Error(data.error || `HTTP ${result.status}`);
  }
  if (requestMethod !== "GET") changed(path, body);
  return data;
}
