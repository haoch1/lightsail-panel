/** Notifications contain no resource data; clients re-read authenticated local endpoints. */
export function registerEvents(app, { store }) {
  app.get("/api/events", (req, res) => {
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ error: "事件连接必须来自面板页面" });
    res.set({ "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const notify = (type) => {
      if (!store.sessionByHash(req.panelSession.hash)) {
        close();
        return;
      }
      if (!res.write(`data: ${type}\n\n`)) close();
    };
    const heartbeat = setInterval(() => notify("heartbeat"), 15000);
    heartbeat.unref();
    const expiry = setTimeout(
      () => close(),
      Math.min(2147483647, Math.max(0, req.panelSession.expires - Date.now())),
    );
    expiry.unref();
    function close() {
      clearInterval(heartbeat);
      clearTimeout(expiry);
      store.onEvent.delete(notify);
      store.onClose.delete(close);
      res.end();
    }
    store.onEvent.add(notify);
    store.onClose.add(close);
    req.on("close", close);
    res.write("data: ready\n\n");
  });
}
