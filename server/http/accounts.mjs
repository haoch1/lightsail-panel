import * as V from "../validation.mjs";
export function registerAccounts(app, { store, gateway, audited }) {
  app.get("/api/accounts", (_req, res) =>
    res.json({ items: store.accounts() }),
  );

  app.post("/api/accounts", async (req, res) => {
    const v = V.account.parse(req.body);
    const saved = await audited("add-account", v.name, v.name, async () => {
      const identity = await gateway.identity(v, v.region);
      const meta = {
        name: v.name,
        region: v.region,
        authType: v.authType,
        ...identity,
        keyHint: `…${v.accessKeyId.slice(-4)}`,
        addedAt: new Date().toISOString(),
      };
      const account = store.saveAccount(meta, v);
      gateway.invalidate();
      return account;
    });
    res.status(201).json(saved);
  });

  app.post("/api/accounts/:id/verify", async (req, res) => {
    const a = store.account(req.params.id);
    const identity = await audited("verify-account", a.name, a.id, () =>
      gateway.identity(a.credentials, a.region),
    );
    res.json({ ok: true, ...identity });
  });

  app.delete("/api/accounts/:id", async (req, res) => {
    const account = store.account(req.params.id);
    const result = await audited(
      "delete-account",
      account.name,
      account.id,
      () => {
        store.deleteAccount(account.id);
        gateway.invalidate();
        return { ok: true };
      },
    );
    res.json(result);
  });
}
