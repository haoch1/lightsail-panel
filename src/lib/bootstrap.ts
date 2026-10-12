import type { Account } from "../../shared/types";

export type Bootstrap = {
  initialized: boolean;
  authenticated: boolean;
  csrf?: string;
  expires?: number;
  accounts?: Account[];
};

/** Server-verified entry data. Development/static hosting falls back to /api/auth. */
function readBootstrap(): Bootstrap | null {
  const element = document.getElementById("panel-bootstrap");
  if (!element) return null;
  try {
    const data = JSON.parse(element.textContent || "");
    if (
      typeof data.initialized !== "boolean" ||
      typeof data.authenticated !== "boolean" ||
      (data.authenticated &&
        (typeof data.csrf !== "string" ||
          typeof data.expires !== "number" ||
          data.expires <= Date.now() ||
          !Array.isArray(data.accounts)))
    )
      return null;
    return data;
  } catch {
    return null;
  } finally {
    element.remove();
  }
}

export const bootstrap = readBootstrap();
