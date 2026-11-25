export function registerAudit(app, { store }) {
  app.get("/api/audit", (req, res) => {
    if (req.query.page === undefined) return res.json({ items: store.logs() });
    const page = Number(req.query.page);
    if (
      typeof req.query.page !== "string" ||
      !/^\d+$/.test(req.query.page) ||
      !Number.isSafeInteger(page)
    )
      return res.status(400).json({ error: "日志页码无效" });
    res.json(store.logPage(page));
  });
  app.delete("/api/audit", (_req, res) =>
    res.json({ deleted: store.clearLogs() }),
  );
}
