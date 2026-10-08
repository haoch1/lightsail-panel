import { z } from "zod";
import * as V from "../validation.mjs";
export function registerMonitoring(app, { gateway, read }) {
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
