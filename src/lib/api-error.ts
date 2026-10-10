export class ApiError extends Error {
  kind: "connection" | "http";
  status?: number;

  constructor(message: string, kind: "connection" | "http", status?: number) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function isConnectionError(error: { message: string; kind?: string }) {
  if (error.kind) return error.kind === "connection";
  return /^(?:无法连接面板服务|连接超时)|Failed to fetch|NetworkError when attempting to fetch resource|^Load failed$/i.test(
    error.message,
  );
}
