import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { Store } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { AwsGateway } from "../server/aws.mjs";
import { accessFiles, openSsh, sshArguments } from "../server/ssh/openssh.mjs";

const root = resolve("../aws-panel-reference");
const target = {
  accountId: "ssh-qa",
  service: "lightsail",
  region: "ap-southeast-1",
  id: "server",
};
const waitFor = async (fn) => {
  const until = Date.now() + 3000;
  while (!fn()) {
    if (Date.now() > until) throw new Error("SSH test timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
class FakePty extends EventEmitter {
  inputs = [];
  sizes = [];
  killed = false;
  onData(fn) {
    this.on("data", fn);
    return { dispose: () => this.off("data", fn) };
  }
  onExit(fn) {
    this.on("exit", fn);
    return { dispose: () => this.off("exit", fn) };
  }
  write(value) {
    this.inputs.push(value);
    this.emit("data", value);
  }
  resize(cols, rows) {
    this.sizes.push([cols, rows]);
  }
  kill() {
    if (!this.killed) {
      this.killed = true;
      this.emit("exit", { exitCode: 0 });
    }
  }
}
async function fixture(t, { delay = 0, accessDetails } = {}) {
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "ssh-test-"));
  const store = new Store(dir);
  store.saveAccount(
    { name: "QA" },
    { accessKeyId: "fake", secretAccessKey: "fake" },
    target.accountId,
  );
  const sessions = [store.createSession(), store.createSession()];
  const terminals = [];
  const secrets = accessDetails || {
    privateKey: "temporary-private-secret",
    certKey: "temporary-certificate-secret",
  };
  const app = createApp(
    store,
    { instanceAccessDetails: async () => secrets },
    {
      sshOpener: async (details, size) => {
        assert.equal(details, secrets);
        if (accessDetails) accessFiles(details);
        await new Promise((r) => setTimeout(r, delay));
        const terminal = new FakePty();
        terminals.push(terminal);
        terminal.sizes.push([size.cols, size.rows]);
        setTimeout(() => {
          if (!terminal.killed) {
            terminal.emit("data", "Welcome\r\n\x1eREADY");
            terminal.emit("data", "\x1fadmin@server:~$ ");
          }
        }, 10);
        return {
          terminal,
          username: "admin",
          host: "198.51.100.10",
          marker: "\x1eREADY\x1f",
          cleanup: async () => {},
        };
      },
    },
  );
  const server = app.listen(0, "127.0.0.1");
  app.locals.ssh.attach(server);
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, session = sessions[0], extras = {}) =>
    fetch(origin + "/api" + path, {
      method: "POST",
      headers: {
        origin,
        cookie: `panel_session=${session.token}`,
        "x-csrf-token": session.csrf,
        "content-type": "application/json",
        ...extras,
      },
      body: JSON.stringify(body),
    });
  const ticket = async (session = sessions[0]) => {
    const response = await request("/ssh/connect", target, session);
    assert.equal(response.status, 200);
    return (await response.json()).ticket;
  };
  const connect = async (value, session = sessions[0]) => {
    const ws = new WebSocket(
      origin.replace("http:", "ws:") + "/api/ssh/terminal",
      { headers: { origin, cookie: `panel_session=${session.token}` } },
    );
    const received = [];
    ws.on("message", (data) => received.push(JSON.parse(data)));
    await once(ws, "open");
    ws.send(
      JSON.stringify({ type: "connect", ticket: value, cols: 80, rows: 24 }),
    );
    return { ws, received };
  };
  t.after(async () => {
    app.locals.ssh.close();
    await new Promise((r) => server.close(r));
    store.close();
    assert.ok(dir.startsWith(root + "/") || dir.startsWith(root + "\\"));
    rmSync(dir, { recursive: true, force: true });
  });
  return { app, store, origin, request, ticket, connect, terminals, sessions };
}

test("SSH ticket issuance requires login, CSRF and same origin; cancellation and connection limits are enforced", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request("/ssh/connect", target, { token: "", csrf: "" })).status,
    401,
  );
  assert.equal(
    (
      await f.request("/ssh/connect", target, f.sessions[0], {
        "x-csrf-token": "wrong",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/ssh/connect", target, f.sessions[0], {
        origin: "https://other.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request("/ssh/connect", { ...target, host: "127.0.0.1" })).status,
    400,
  );
  const tickets = await Promise.all(
    Array.from({ length: 4 }, () => f.ticket()),
  );
  assert.equal((await f.request("/ssh/connect", target)).status, 429);
  await f.request("/ssh/cancel", { ticket: tickets[0] }, f.sessions[1]);
  assert.equal((await f.request("/ssh/connect", target)).status, 429);
  await f.request("/ssh/cancel", { ticket: tickets[0] });
  assert.equal((await f.request("/ssh/connect", target)).status, 200);
  assert.equal(f.terminals.length, 0);
});

test("SSH websocket rejects cross-origin or unauthenticated upgrades", async (t) => {
  const f = await fixture(t);
  for (const headers of [
    { origin: f.origin },
    {
      origin: "https://other.example",
      cookie: `panel_session=${f.sessions[0].token}`,
    },
  ]) {
    const ws = new WebSocket(
      f.origin.replace("http:", "ws:") + "/api/ssh/terminal",
      { headers },
    );
    const error = await new Promise((r) => ws.once("error", r));
    assert.match(error.message, /403/);
  }
  assert.equal(f.terminals.length, 0);
});

test("SSH certificate details remain server-side; marker fragments, input, controls and resize are bridged", async (t) => {
  const f = await fixture(t);
  const key = await f.ticket();
  const { ws, received } = await f.connect(key);
  await waitFor(() => received.some((m) => m.type === "ready"));
  assert.equal(received.find((m) => m.type === "ready").username, "admin");
  ws.send(JSON.stringify({ type: "input", data: "whoami\r\x03\t\x1b" }));
  ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 35 }));
  await waitFor(() => f.terminals[0].sizes.length === 2);
  assert.deepEqual(f.terminals[0].sizes.at(-1), [120, 35]);
  assert.equal(f.terminals[0].inputs[0], "whoami\r\x03\t\x1b");
  assert.ok(!JSON.stringify(received).includes("temporary-private-secret"));
  assert.ok(!JSON.stringify(received).includes("temporary-certificate-secret"));
  assert.ok(!JSON.stringify(received).includes("READY"));
  assert.ok(!JSON.stringify(f.store.logs()).includes("whoami"));
  const duplicate = await f.connect(key);
  await waitFor(() => duplicate.received.some((m) => m.type === "error"));
  assert.equal(f.terminals.length, 1);
  ws.close();
  await waitFor(() => f.terminals[0].killed);
  assert.equal(f.app.locals.ssh.connections.size, 0);
});

test("SSH ticket belongs to its issuing session; expiry and logout terminate active terminals", async (t) => {
  const f = await fixture(t);
  const key = await f.ticket();
  const other = await f.connect(key, f.sessions[1]);
  await waitFor(() => other.received.some((m) => m.type === "error"));
  const good = await f.connect(key);
  await waitFor(() => good.received.some((m) => m.type === "ready"));
  await f.request("/logout", {});
  await waitFor(() => f.terminals[0].killed);
  const expires = await f.connect(await f.ticket(f.sessions[1]), f.sessions[1]);
  await waitFor(() => expires.received.some((m) => m.type === "ready"));
  f.store.deleteSession(f.sessions[1].token);
  f.app.locals.ssh.sweep();
  await waitFor(() => f.terminals[1].killed);
});

test("closing SSH while credentials/connect are pending cannot leave an orphan terminal", async (t) => {
  const f = await fixture(t, { delay: 60 });
  const { ws } = await f.connect(await f.ticket());
  await new Promise((r) => setTimeout(r, 15));
  ws.close();
  await waitFor(() => f.terminals.length && f.terminals[0].killed);
  assert.equal(f.app.locals.ssh.connections.size, 0);
});

test("SSH gateway gates stopped instances and requests temporary SSH credentials for the target", async () => {
  const gateway = new AwsGateway({ account: () => ({ id: target.accountId }) });
  const calls = [];
  let state = "stopped";
  gateway.send = async (_account, service, region, command, args) => {
    calls.push({ service, region, command, args });
    return command === "GetInstance"
      ? { instance: { state: { name: state } } }
      : { accessDetails: { instanceName: target.id } };
  };
  await assert.rejects(gateway.instanceAccessDetails(target), /尚未运行/);
  assert.equal(calls.length, 1);
  state = "running";
  await gateway.instanceAccessDetails(target);
  assert.deepEqual(calls.at(-1), {
    service: "lightsail",
    region: target.region,
    command: "GetInstanceAccessDetails",
    args: { instanceName: "server", protocol: "ssh" },
  });
});

function credentials() {
  const key = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const alg = Buffer.from("ssh-ed25519");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(alg.length);
  const bytes = Buffer.concat([size, alg, Buffer.alloc(36, 1)]);
  return {
    ipAddress: "198.51.100.10",
    username: "admin",
    privateKey: key.privateKey,
    certKey: "ssh-rsa-cert-v01@openssh.com AAAABBBB",
    expiresAt: new Date(Date.now() + 60000),
    hostKeys: [{ publicKey: bytes.toString("base64") }],
  };
}

test("SSH accepts credentials without the optional expiresAt field while rejecting expired or invalid timestamps", () => {
  const details = credentials();
  const { expiresAt: _expires, ...withoutExpiry } = details;
  assert.equal(accessFiles(withoutExpiry).username, "admin");
  assert.equal(accessFiles({ ...details, expiresAt: null }).username, "admin");
  assert.equal(accessFiles(details).username, "admin");
  assert.throws(
    () => accessFiles({ ...details, expiresAt: new Date(0) }),
    /凭证已到期/,
  );
  assert.throws(
    () => accessFiles({ ...details, expiresAt: new Date(NaN) }),
    /到期时间无效/,
  );
});

test("SSH websocket reaches the terminal when AWS omits expiresAt", async (t) => {
  const details = credentials();
  delete details.expiresAt;
  const f = await fixture(t, { accessDetails: details });
  const { ws, received } = await f.connect(await f.ticket());
  await waitFor(() => received.some((m) => m.type === "ready"));
  assert.equal(
    received.some((m) => m.type === "error"),
    false,
  );
  assert.equal(f.terminals.length, 1);
  ws.close();
  await waitFor(() => f.terminals[0].killed);
});

test("OpenSSH uses pinned host keys and certificate auth, ignores ambient config, and removes temporary keys", async (t) => {
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "ssh-files-test-"));
  t.after(() => {
    assert.ok(dir.startsWith(root + "/") || dir.startsWith(root + "\\"));
    rmSync(dir, { recursive: true, force: true });
  });
  const details = credentials();
  let captured;
  const fake = new FakePty();
  const opened = await openSsh(
    details,
    { cols: 80, rows: 24 },
    {
      directory: dir,
      spawnPty: (command, args, options) => {
        captured = { command, args, options };
        return fake;
      },
    },
  );
  assert.equal(captured.args[captured.args.indexOf("-l") + 1], "admin");
  assert.ok(captured.args.includes("StrictHostKeyChecking=yes"));
  assert.ok(captured.args.includes("ForwardAgent=no"));
  assert.equal(captured.options.env.ENCRYPTION_KEY, undefined);
  const folder = join(dir, readdirSync(dir)[0]);
  assert.equal(
    readFileSync(join(folder, "identity"), "utf8"),
    details.privateKey,
  );
  assert.equal(
    readFileSync(join(folder, "identity-cert.pub"), "utf8").trim(),
    details.certKey,
  );
  assert.match(
    readFileSync(join(folder, "known_hosts"), "utf8"),
    /^198\.51\.100\.10 ssh-ed25519 /,
  );
  const config = execFileSync(
    process.platform === "win32" ? "ssh.exe" : "ssh",
    [
      "-G",
      ...sshArguments(
        {
          key: join(folder, "identity"),
          cert: join(folder, "identity-cert.pub"),
          hosts: join(folder, "known_hosts"),
        },
        "198.51.100.10",
        "admin",
      ),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.match(config, /batchmode yes/);
  assert.match(config, /stricthostkeychecking true/);
  fake.kill();
  await opened.cleanup();
  assert.deepEqual(readdirSync(dir), []);
  assert.throws(() => accessFiles({ ...details, hostKeys: [] }), /主机密钥/);
  assert.throws(
    () => accessFiles({ ...details, username: "-oProxyCommand=evil" }),
    /用户名/,
  );
  assert.throws(
    () => accessFiles({ ...details, expiresAt: new Date(0) }),
    /已到期/,
  );
});
