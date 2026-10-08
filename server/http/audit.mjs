export function registerAudit(app, { store }) {
  app.get("/api/audit", (_req, res) => res.json({ items: store.logs() }));
}
