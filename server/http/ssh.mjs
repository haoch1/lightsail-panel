import { z } from "zod";
import * as V from "../validation.mjs";
export function registerSsh(app, { gateway, audited, ssh }) {
  app.post("/api/ssh/connect", (req, res) => {
    const target = V.target.strict().parse(req.body);
    res.json(ssh.issue(target, req.panelSession));
  });
  app.post("/api/ssh/cancel", (req, res) => {
    const { ticket } = z
      .object({ ticket: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(req.body);
    ssh.cancel(ticket, req.panelSession.hash);
    res.json({ ok: true });
  });
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
