import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { scrubError } from "../aws/shared.mjs";
import { openSsh } from "./openssh.mjs";

const size = {
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(300),
};
const message = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("connect"),
      ticket: z.string().regex(/^[a-f0-9]{64}$/),
      ...size,
    })
    .strict(),
  z.object({ type: z.literal("input"), data: z.string().max(32768) }).strict(),
  z.object({ type: z.literal("resize"), ...size }).strict(),
]);
const cookieToken = (req) =>
  /(?:^|;\s*)panel_session=([a-f0-9]+)/.exec(req.headers.cookie || "")?.[1];

export class SshSessions {
  tickets = new Map();
  connections = new Set();
  constructor(store, gateway, { publicOrigin = "", opener = openSsh } = {}) {
    this.store = store;
    this.gateway = gateway;
    this.publicOrigin = publicOrigin;
    this.opener = opener;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 65536,
      perMessageDeflate: false,
    });
    this.wss.on("connection", (ws, req, session) =>
      this.connection(ws, req, session),
    );
    this.timer = setInterval(() => this.sweep(), 15000);
    this.timer.unref();
    store.onClose.add(() => this.close());
  }
  issue(target, session) {
    for (const [key, t] of this.tickets)
      if (t.until <= Date.now() || !this.store.sessionByHash(t.hash))
        this.tickets.delete(key);
    this.store.account(target.accountId);
    const count = [...this.tickets.values(), ...this.connections].filter(
      (c) => c.hash === session.hash,
    ).length;
    if (count >= 4 || this.tickets.size + this.connections.size >= 16)
      throw Object.assign(
        new Error("SSH 连接数量已达上限，请关闭已有终端后重试"),
        { status: 429 },
      );
    const ticket = randomBytes(32).toString("hex");
    this.tickets.set(ticket, {
      target,
      hash: session.hash,
      until: Date.now() + 45000,
    });
    return { ticket };
  }
  cancel(ticket, hash) {
    if (this.tickets.get(ticket)?.hash === hash) this.tickets.delete(ticket);
  }
  attach(server) {
    server.on("upgrade", (req, socket, head) => {
      const expected = this.publicOrigin || `http://${req.headers.host}`;
      const session = this.store.session(cookieToken(req));
      if (
        req.url !== "/api/ssh/terminal" ||
        req.headers.origin !== expected ||
        !session
      ) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      const count = [...this.connections].filter(
        (c) => c.hash === session.hash,
      ).length;
      if (count >= 4 || this.connections.size >= 16) {
        socket.end(
          "HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n",
        );
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) =>
        this.wss.emit("connection", ws, req, session),
      );
    });
    server.on("close", () => this.close());
  }
  connection(ws, req, session) {
    const state = {
      ws,
      hash: session.hash,
      token: cookieToken(req),
      target: null,
      alive: true,
      opened: null,
      ended: false,
      authenticated: false,
    };
    this.connections.add(state);
    const send = (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
    };
    const end = (reason) => {
      if (state.ended) return;
      state.ended = true;
      clearTimeout(state.deadline);
      clearTimeout(state.connectTimeout);
      if (reason) send({ type: "error", message: reason });
      try {
        state.opened?.terminal.kill();
      } catch {
        /* already exited */
      }
      ws.close(1000);
      const forceClose = setTimeout(() => ws.terminate(), 1000);
      forceClose.unref();
      ws.once("close", () => clearTimeout(forceClose));
      this.connections.delete(state);
    };
    state.end = end;
    state.deadline = setTimeout(
      () => end("SSH 连接验证超时，请重新连接"),
      10000,
    );
    ws.on("error", () => end());
    ws.on("close", () => end());
    ws.on("pong", () => {
      state.alive = true;
    });
    ws.on("message", async (raw, binary) => {
      if (state.ended) return;
      try {
        if (!this.store.session(state.token)) {
          end("面板登录已失效，SSH 连接已断开");
          return;
        }
        const m = binary ? null : message.parse(JSON.parse(raw.toString()));
        if (!m) throw new Error();
        if (m.type === "connect") {
          if (state.authenticated) throw new Error();
          const ticket = this.tickets.get(m.ticket);
          if (
            !ticket ||
            ticket.hash !== state.hash ||
            ticket.until <= Date.now()
          ) {
            end("SSH 连接凭证已失效，请重新连接");
            return;
          }
          this.tickets.delete(m.ticket);
          state.authenticated = true;
          state.target = ticket.target;
          clearTimeout(state.deadline);
          state.connectTimeout = setTimeout(
            () => end("SSH 连接超时，请检查实例状态与 SSH 端口"),
            40000,
          );
          let details;
          let opened;
          try {
            details = await this.gateway.instanceAccessDetails(ticket.target);
            if (state.ended || !this.store.session(state.token)) {
              end();
              return;
            }
            opened = await this.opener(details, { cols: m.cols, rows: m.rows });
          } finally {
            details = null;
          }
          state.opened = opened;
          if (state.ended || !this.store.session(state.token)) {
            try {
              opened.terminal.kill();
            } catch {
              /* already closed */
            }
            await opened.cleanup();
            end();
            return;
          }
          send({
            type: "connecting",
            username: opened.username,
            host: opened.host,
          });
          let buffer = "";
          state.ready = false;
          opened.terminal.onData((data) => {
            if (ws.bufferedAmount > 1024 * 1024) {
              end("终端输出过快，连接已断开，请重新连接");
              return;
            }
            if (!state.ready) {
              buffer += data;
              const index = buffer.indexOf(opened.marker);
              if (index < 0) {
                const count = Math.max(0, buffer.length - opened.marker.length);
                if (count)
                  send({ type: "output", data: buffer.slice(0, count) });
                buffer = buffer.slice(count);
                return;
              }
              data =
                buffer.slice(0, index) +
                buffer.slice(index + opened.marker.length);
              buffer = "";
              state.ready = true;
              clearTimeout(state.connectTimeout);
              send({
                type: "ready",
                username: opened.username,
                host: opened.host,
              });
              this.store.audit({
                account: ticket.target.accountId,
                action: "ssh-connect",
                target: ticket.target.id,
              });
            }
            send({ type: "output", data });
          });
          opened.terminal.onExit(({ exitCode }) => {
            if (buffer) send({ type: "output", data: buffer });
            if (!state.ready)
              this.store.audit({
                account: ticket.target.accountId,
                action: "ssh-connect",
                target: ticket.target.id,
                status: "failed",
                detail: `OpenSSH exited (${exitCode})`,
              });
            send({ type: "exit", code: exitCode });
            end();
          });
        } else {
          if (!state.opened) throw new Error();
          if (m.type === "input") {
            if (state.ready) state.opened.terminal.write(m.data);
          } else state.opened.terminal.resize(m.cols, m.rows);
        }
      } catch (e) {
        const reason =
          e instanceof z.ZodError || e instanceof SyntaxError
            ? "终端请求格式无效"
            : scrubError(e);
        if (state.target && !state.ended)
          this.store.audit({
            account: state.target.accountId,
            action: "ssh-connect",
            target: state.target.id,
            status: "failed",
            detail: reason,
          });
        end(reason || "SSH 连接失败，请重新连接");
      }
    });
  }
  sweep() {
    for (const [key, t] of this.tickets)
      if (t.until <= Date.now() || !this.store.sessionByHash(t.hash))
        this.tickets.delete(key);
    for (const c of this.connections) {
      if (!this.store.session(c.token)) {
        c.end("面板登录已失效，SSH 连接已断开");
        continue;
      }
      if (c.target) {
        try {
          this.store.account(c.target.accountId);
        } catch {
          c.end("AWS 账户已移除，SSH 连接已断开");
          continue;
        }
      }
      if (!c.alive) {
        c.end();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }
  revoke(hash) {
    for (const [key, t] of this.tickets)
      if (t.hash === hash) this.tickets.delete(key);
    for (const c of this.connections)
      if (c.hash === hash) c.end("面板已退出登录，SSH 连接已断开");
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.tickets.clear();
    for (const c of this.connections) c.end();
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }
}
