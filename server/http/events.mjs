/** Notifications contain no resource data; clients re-read authenticated local endpoints. */
export function registerEvents(app, { store }) {
  app.get("/api/events", (req, res) => {
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ error: "事件连接必须来自面板页面" });
    res.set({ "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    let closed = false;
    let expiry;
    const scheduleExpiry = (expiresAt) => {
      clearTimeout(expiry);
      expiry = setTimeout(() => {
        const active = store.sessionByHash(req.panelSession.hash);
        if (!active) close();
        else scheduleExpiry(active.expires);
      }, Math.min(2147483647, Math.max(0, expiresAt - Date.now())));
      expiry.unref();
    };
    const notify = (type) => {
      if (closed || res.writableEnded) return close();
      if (!store.sessionByHash(req.panelSession.hash)) {
        close();
        return;
      }
      try {
        if (!res.write(`data: ${type}\n\n`)) close();
      } catch {
        close();
      }
    };
    const heartbeat = setInterval(() => notify("heartbeat"), 15000);
    heartbeat.unref();
    scheduleExpiry(req.panelSession.expires);
    function close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(expiry);
      store.onEvent.delete(notify);
      store.onClose.delete(close);
      if (!res.writableEnded) res.end();
    }
    store.onEvent.add(notify);
    store.onClose.add(close);
    req.on("close", close);
    try {
      res.write("data: ready\n\n");
    } catch {
      close();
    }
  });
}
