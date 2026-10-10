import { z } from "zod";
import { scrubError } from "../aws/shared.mjs";
import * as V from "../validation.mjs";
export function routeContext(store) {
  function context(req) {
    return z
      .object({
        accountId: z.string().min(1),
        region: V.region.default("us-east-1"),
      })
      .parse(req.query);
  }
  async function audited(action, target, account, fn) {
    try {
      const result = await fn();
      const submitted =
        result?.networkJob?.status === "pending" ||
        result?.operations?.some(
          (operation) => !["Succeeded", "Completed"].includes(operation.status),
        );
      store.audit({
        account,
        action,
        target,
        status: submitted ? "submitted" : "success",
        detail: result?.unchanged ? result.notice : "",
      });
      return result;
    } catch (e) {
      store.audit({
        account,
        action,
        target,
        status: "failed",
        detail: scrubError(e),
      });
      throw e;
    }
  }
  return { context, audited, launchRequests: new Map() };
}
