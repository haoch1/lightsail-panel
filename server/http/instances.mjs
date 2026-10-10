import { z } from "zod";
import * as V from "../validation.mjs";
import { launchFingerprint } from "../launch-network.mjs";
export function registerInstances(
  app,
  { store, gateway, context, audited, launchRequests, launchNetwork, read },
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
    const result = await read(req, () =>
      gateway.scan(ids, q.service, q.region),
    );
    for (const item of result.items)
      if (
        [
          "pending",
          "starting",
          "stopping",
          "rebooting",
          "shutting-down",
        ].includes(item.state)
      )
        launchNetwork.watch({
          accountId: item.accountId,
          region: item.region,
          id: item.id,
          passive: true,
          retry: req.query.refresh === "1",
          action:
            item.state === "stopping"
              ? "stop"
              : item.state === "shutting-down"
                ? "terminate"
                : "start",
        });
    res.json(result);
  });

  app.post("/api/instances/action", async (req, res) => {
    const v = V.action.parse(req.body);
    if (v.action === "terminate" && v.confirm !== v.id)
      return res.status(400).json({ error: "请输入实例 ID 确认终止" });
    const result = await audited(v.action, v.id, v.accountId, () =>
      launchNetwork.run(v, "instances", () => gateway.perform(v)),
    );
    res.json(result);
  });

  app.get("/api/catalog", async (req, res) => {
    const q = { ...context(req), service: V.service.parse(req.query.service) };
    res.json(
      await read(req, () => gateway.catalog(q.accountId, q.service, q.region)),
    );
  });

  app.get("/api/launch/network", (_req, res) =>
    res.json({ items: launchNetwork.recent() }),
  );

  app.post("/api/launch", async (req, res) => {
    const v = V.launch.parse(req.body);
    const key = `${v.accountId}:${v.token}`;
    const fingerprint = JSON.stringify(v);
    const saved = store.launchNetwork(v.token);
    if (saved) {
      if (
        saved.accountId !== v.accountId ||
        saved.fingerprint !== launchFingerprint(v)
      )
        return res
          .status(409)
          .json({ error: "幂等令牌已用于其他创建参数，请重新打开创建页面" });
      return res.json({
        networkJob: launchNetwork.view(saved),
        notice: "创建请求已提交，请查看网络配置进度",
      });
    }
    const existing = launchRequests.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        return res
          .status(409)
          .json({ error: "幂等令牌已用于其他创建参数，请重新打开创建页面" });
      return res.json(await existing.promise);
    }
    const promise = audited("launch", v.name, v.accountId, async () => {
      const result = await gateway.launch(v);
      return {
        ...result,
        networkJob: launchNetwork.enqueue(v, result),
        notice: "创建请求已提交，实例就绪后将自动配置网络",
      };
    });
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
