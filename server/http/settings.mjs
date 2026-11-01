import { z } from "zod";
import { notificationInput } from "../notifications.mjs";

export function registerSettings(app, { notifications }) {
  app.get("/api/settings", (_req, res) =>
    res.json({ notifications: notifications.settings() }),
  );
  app.put("/api/settings", (req, res) => {
    const { notifications: input } = z
      .object({ notifications: notificationInput })
      .strict()
      .parse(req.body);
    res.json({ notifications: notifications.update(input) });
  });
  app.get("/api/notifications", (_req, res) =>
    res.json({ items: notifications.records() }),
  );
  app.post("/api/notifications/test", (req, res) => {
    z.object({}).strict().parse(req.body);
    res.status(202).json(notifications.test());
  });
}
