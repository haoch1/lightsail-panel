import { z } from "zod";
import { scrubError } from "../aws/shared.mjs";
import * as V from "../validation.mjs";
import { auditDefaultDetail } from "../../shared/audit-actions.ts";
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
    const auditId = store.audit({
      account,
      action,
      target,
      status: "submitted",
    });
    try {
      const result = await fn(auditId);
      const submitted =
        result?.networkJob?.status === "pending" ||
        result?.operations?.some(
          (operation) => !["Succeeded", "Completed"].includes(operation.status),
        );
      const status = submitted ? "submitted" : "success";
      store.updateAudit(auditId, {
        status,
        detail: result?.unchanged
          ? result.notice || "资源已满足请求条件，无需重复修改"
          : submitted
            ? "AWS 已受理请求，正在确认资源状态"
            : [auditDefaultDetail(action, status), result?.notice]
                .filter(Boolean)
                .join("；"),
      });
      return result;
    } catch (e) {
      store.updateAudit(auditId, {
        status: "failed",
        detail: scrubError(e),
      });
      throw e;
    }
  }
  return { context, audited, launchRequests: new Map() };
}
