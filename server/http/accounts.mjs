import * as V from "../validation.mjs";
export function registerAccounts(app, { store, gateway }) {
  app.get("/api/accounts", (_req, res) =>
    res.json({ items: store.accounts() }),
  );

  app.post("/api/accounts", async (req, res) => {
    const v = V.account.parse(req.body);
    const identity = await gateway.identity(v, v.region);
    const meta = {
      name: v.name,
      region: v.region,
      authType: v.authType,
      ...identity,
      keyHint: `…${v.accessKeyId.slice(-4)}`,
      hasRole: !!v.roleArn,
      addedAt: new Date().toISOString(),
    };
    const saved = store.saveAccount(meta, v);
    gateway.invalidate();
    store.audit({
      account: saved.name,
      action: "add-account",
      target: saved.awsAccountId,
    });
    res.status(201).json(saved);
  });

  app.post("/api/accounts/:id/verify", async (req, res) => {
    const a = store.account(req.params.id);
    const identity = await gateway.identity(a.credentials, a.region);
    res.json({ ok: true, ...identity });
  });

  app.delete("/api/accounts/:id", (req, res) => {
    store.account(req.params.id);
    store.deleteAccount(req.params.id);
    gateway.invalidate();
    store.audit({ action: "delete-account", target: req.params.id });
    res.json({ ok: true });
  });
}
