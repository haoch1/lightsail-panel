import { z } from "zod";
import * as V from "../validation.mjs";
export function registerSsh(app, { gateway, context, audited }) {
  app.post("/api/ssh/default-key", async (req, res) => {
    const q = z
      .object({ accountId: z.string().min(1), region: V.region })
      .parse(req.body);
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Pragma", "no-cache");
    res.json(
      await audited("download-default-key", q.region, q.accountId, () =>
        gateway.downloadDefaultKeyPair(q.accountId, q.region),
      ),
    );
  });
}
