import * as V from "../validation.mjs";
export function registerNetworking(app, { gateway, context, audited, read }) {
  app.get("/api/static-ips", async (req, res) => {
    const q = context(req);
    res.json(
      await read(req, async () => ({
        items: await gateway.staticIps(q.accountId, q.region),
        at: new Date().toISOString(),
      })),
    );
  });

  app.post("/api/static-ips", async (req, res) => {
    const v = V.staticIp.parse(req.body);
    if (v.action === "release" && v.confirm !== v.name)
      return res.status(400).json({ error: "请输入静态 IP 名称确认释放" });
    res.json(
      await audited("static-ip-" + v.action, v.name, v.accountId, () =>
        gateway.staticIpOperation(v),
      ),
    );
  });

  app.get("/api/ports", async (req, res) => {
    const target = V.target.parse(req.query);
    res.json(await read(req, () => gateway.ports(target)));
  });

  app.post("/api/ports", async (req, res) => {
    const v = V.publicPorts.parse(req.body);
    res.json(
      await audited(
        v.close ? "close-port" : "open-port",
        v.id,
        v.accountId,
        () => gateway.updatePorts(v),
      ),
    );
  });
}
