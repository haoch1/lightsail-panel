import { z } from "zod";
import * as V from "../validation.mjs";
import { scrubError } from "../aws/shared.mjs";
export function registerMonitoring(
  app,
  { store, gateway, read, trafficGuard },
) {
  app.get("/api/traffic-limit", (req, res) => {
    const target = V.target.parse(req.query);
    res.json({ rule: trafficGuard.get(target) });
  });
  app.post("/api/traffic-limit", async (req, res) => {
    const input = V.trafficLimit.parse(req.body);
    try {
      res.json({ rule: await trafficGuard.configure(input) });
    } catch (e) {
      store.audit({
        account: input.accountId,
        action: "traffic-limit",
        target: input.id,
        status: "failed",
        detail: scrubError(e),
      });
      throw e;
    }
    if (input.enabled) trafficGuard.kick();
  });
  app.get("/api/traffic", async (req, res) => {
    const t = V.target.parse(req.query);
    const range = z
      .enum(["month", "today", "7d", "30d"])
      .parse(req.query.range || "month");
    const offset = z.coerce
      .number()
      .int()
      .min(-720)
      .max(840)
      .parse(req.query.utcOffsetMinutes || 0);
    res.json(
      await read(req, () => gateway.traffic(t, range, new Date(), offset)),
    );
  });
}
