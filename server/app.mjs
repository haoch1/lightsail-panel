import express from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { scrubError } from "./aws.mjs";
import { registerAccounts } from "./http/accounts.mjs";
import { registerAudit } from "./http/audit.mjs";
import { routeContext } from "./http/context.mjs";
import { registerInstances } from "./http/instances.mjs";
import { registerMonitoring } from "./http/monitoring.mjs";
import { registerNetworking } from "./http/networking.mjs";
import { registerSsh } from "./http/ssh.mjs";
import { SshSessions } from "./ssh/sessions.mjs";
import { ReadCache } from "./read-cache.mjs";
import { LaunchNetworkQueue } from "./launch-network.mjs";
import { TrafficGuard } from "./traffic-guard.mjs";
import { sessionHours } from "./validation.mjs";
import { matchesUpdate, mutationUpdate } from "../shared/resource-update.ts";

export function createApp(
  store,
  gateway,
  {
    publicOrigin = process.env.PUBLIC_ORIGIN || "",
    dist = resolve("dist"),
    sshOpener,
  } = {},
) {
  const app = express();
  const reads = new ReadCache();
  const ssh = new SshSessions(store, gateway, {
    publicOrigin,
    opener: sshOpener,
  });
  app.locals.ssh = ssh;
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: [
            "'self'",
            (req) =>
              (publicOrigin || `${req.protocol}://${req.headers.host}`).replace(
                /^http/,
                "ws",
              ),
          ],
          fontSrc: ["'self'", "data:"],
          upgradeInsecureRequests: publicOrigin.startsWith("https:")
            ? []
            : null,
        },
      },
      strictTransportSecurity: publicOrigin.startsWith("https:")
        ? undefined
        : false,
    }),
  );
  app.use(express.json({ limit: "128kb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      const expected = publicOrigin || `${req.protocol}://${req.headers.host}`;
      if (
        (origin && origin !== expected) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return res.status(403).json({ error: "请求来源不被允许" });
    }
    next();
  });
  function token(req) {
    return /(?:^|;\s*)panel_session=([a-f0-9]+)/.exec(
      req.headers.cookie || "",
    )?.[1];
  }
  function cookie(res, value, expires) {
    res.cookie("panel_session", value, {
      httpOnly: true,
      sameSite: "strict",
      secure: publicOrigin.startsWith("https:"),
      path: "/",
      maxAge: Math.max(0, expires - Date.now()),
    });
  }
  const attempts = new Map();
  function limit(req, res, next) {
    const key = req.socket.remoteAddress;
    const a = attempts.get(key);
    if (a && a.until > Date.now() && a.count >= 10)
      return res.status(429).json({ error: "尝试次数过多，请 10 分钟后重试" });
    if (!a || a.until < Date.now())
      attempts.set(key, { until: Date.now() + 600000, count: 1 });
    else a.count++;
    if (attempts.size > 1000)
      for (const [k, v] of attempts)
        if (v.until < Date.now()) attempts.delete(k);
    next();
  }
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, version: "1.7.5", service: "lightsail" }),
  );
  app.get("/api/auth", (req, res) => {
    const s = store.session(token(req));
    res.json({
      initialized: !!store.config("admin"),
      authenticated: !!s,
      csrf: s?.csrf,
      expires: s?.expires,
    });
  });
  const password = z.object({
    password: z.string().min(12, "管理员密码至少 12 位").max(200),
    sessionHours: sessionHours.default(720),
  });
  app.post("/api/setup", limit, (req, res) => {
    if (store.config("admin"))
      return res.status(409).json({ error: "面板已经初始化" });
    const data = password.parse(req.body);
    store.setPassword(data.password);
    const s = store.createSession(data.sessionHours);
    cookie(res, s.token, s.expires);
    store.audit({ action: "setup", status: "success" });
    res.json({ csrf: s.csrf, expires: s.expires });
  });
  app.post("/api/login", limit, (req, res) => {
    const data = z
      .object({
        password: z.string().min(1).max(200),
        sessionHours: sessionHours.default(720),
      })
      .parse(req.body);
    if (!store.verifyPassword(data.password))
      return res.status(401).json({ error: "密码不正确" });
    attempts.delete(req.socket.remoteAddress);
    const s = store.createSession(data.sessionHours);
    cookie(res, s.token, s.expires);
    res.json({ csrf: s.csrf, expires: s.expires });
  });
  app.use("/api", (req, res, next) => {
    const s = store.session(token(req));
    if (!s) return res.status(401).json({ error: "请先登录面板" });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-csrf-token"] !== s.csrf
    )
      return res.status(403).json({ error: "会话校验失败，请刷新页面" });
    req.panelSession = s;
    next();
  });
  app.post("/api/logout", (req, res) => {
    ssh.revoke(req.panelSession.hash);
    store.deleteSession(token(req));
    res.clearCookie("panel_session", { path: "/" });
    res.json({ ok: true });
  });

  app.post("/api/session", (req, res) => {
    const { hours } = z
      .object({ hours: sessionHours })
      .strict()
      .parse(req.body);
    const value = token(req);
    const s = store.renewSession(value, hours);
    cookie(res, value, s.expires);
    res.json(s);
  });

  // Resource mutations invalidate their own scope; account changes invalidate all snapshots.
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const path = req.path;
      const update = mutationUpdate(path, req.body);
      res.on("finish", () => {
        if (update) reads.invalidate((path) => matchesUpdate(path, update));
        else if (
          res.statusCode < 400 &&
          path !== "/traffic-limit" &&
          path !== "/audit" &&
          !path.startsWith("/ssh/")
        )
          reads.clear();
      });
    }
    next();
  });

  const services = {
    store,
    gateway,
    ssh,
    read: reads.read.bind(reads),
    ...routeContext(store),
  };
  let trafficGuard;
  const launchNetwork = new LaunchNetworkQueue(store, gateway, (job) => {
    trafficGuard?.resourceUpdated(job);
    reads.invalidate((path) =>
      matchesUpdate(path, {
        ...job,
        resources: job.resources || ["instances", "static-ips", "ports"],
      }),
    );
  });
  services.launchNetwork = launchNetwork;
  launchNetwork.start();
  registerAccounts(app, services);
  registerInstances(app, services);
  registerSsh(app, services);
  trafficGuard = new TrafficGuard(store, gateway, (target, result) => {
    launchNetwork.watch({ ...target, action: "stop" }, result);
    reads.invalidate((path) =>
      matchesUpdate(path, { ...target, resources: ["instances"] }),
    );
  });
  services.trafficGuard = trafficGuard;
  trafficGuard.start();
  registerMonitoring(app, services);
  registerNetworking(app, services);
  registerAudit(app, services);
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  if (existsSync(dist)) {
    app.use(
      "/assets",
      express.static(resolve(dist, "assets"), {
        maxAge: "1y",
        immutable: true,
      }),
      (_req, res) =>
        res
          .status(404)
          .set("Cache-Control", "no-store")
          .type("text/plain")
          .send("页面资源已更新，请重新加载面板。"),
    );
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, file) =>
          res.setHeader(
            "Cache-Control",
            file.endsWith(".html") ? "no-store" : "no-cache",
          ),
      }),
    );
    app.get("/{*path}", (_req, res) =>
      res
        .set("Cache-Control", "no-store")
        .sendFile(resolve(dist, "index.html")),
    );
  }
  app.use((e, _req, res, _next) => {
    if (e instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: e.issues.map((x) => x.message).join("；") });
    const status =
      e.status ||
      ([401, 403, 404, 429].includes(e.$metadata?.httpStatusCode)
        ? e.$metadata.httpStatusCode
        : 502);
    res.status(status).json({
      error: scrubError(e),
      code: e.name || "Error",
      requestId: e.$metadata?.requestId,
    });
  });
  return app;
}
