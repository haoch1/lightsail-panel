import { z } from "zod";
import * as V from "../validation.mjs";
export function registerInstances(
  app,
  { store, gateway, context, audited, launchRequests, read },
) {
  app.get("/api/regions", async (req, res) => {
    const id = z.string().min(1).parse(req.query.accountId);
    const service = V.service.parse(req.query.service || "lightsail");
    res.json(
      await read(req, async () => ({
        items: await gateway.regions(store.account(id), service),
      })),
    );
  });

  app.get("/api/instances", async (req, res) => {
    const q = z
      .object({
        accountId: z.string().min(1),
        region: V.region.or(z.literal("all")),
        service: V.service,
      })
      .parse(req.query);
    const ids =
      q.accountId === "all" ? store.accounts().map((a) => a.id) : [q.accountId];
    res.json(await read(req, () => gateway.scan(ids, q.service, q.region)));
  });

  app.post("/api/instances/action", async (req, res) => {
    const v = V.action.parse(req.body);
    if (v.action === "terminate" && v.confirm !== v.id)
      return res.status(400).json({ error: "请输入实例 ID 确认终止" });
    res.json(
      await audited(v.action, v.id, v.accountId, () => gateway.perform(v)),
    );
  });

  app.get("/api/catalog", async (req, res) => {
    const q = { ...context(req), service: V.service.parse(req.query.service) };
    res.json(
      await read(req, () => gateway.catalog(q.accountId, q.service, q.region)),
    );
  });

  app.post("/api/launch", async (req, res) => {
    const v = V.launch.parse(req.body);
    const key = `${v.accountId}:${v.token}`;
    const fingerprint = JSON.stringify(v);
    const existing = launchRequests.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        return res
          .status(409)
          .json({ error: "幂等令牌已用于其他创建参数，请重新打开创建页面" });
      return res.json(await existing.promise);
    }
    const promise = audited("launch", v.name, v.accountId, () =>
      gateway.launch(v),
    );
    launchRequests.set(key, { fingerprint, promise });
    try {
      res.json(await promise);
    } catch (e) {
      launchRequests.delete(key);
      throw e;
    } finally {
      if (launchRequests.size > 1000)
        launchRequests.delete(launchRequests.keys().next().value);
    }
  });
}
