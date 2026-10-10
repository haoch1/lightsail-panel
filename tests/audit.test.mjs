import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { auditActionLabel } from "../shared/audit-actions.ts";
import { createApp } from "../server/app.mjs";
import { Store } from "../server/store.mjs";
import * as V from "../server/validation.mjs";

function fixture(t) {
  const root = resolve("../90_临时/lightsail-panel-audit");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "audit-test-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    assert.ok(dir.startsWith(root + "\\") || dir.startsWith(root + "/"));
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

test("audit labels cover resource actions and preserve professional terms", () => {
  const actions = [
    ...V.action.shape.action.options,
    ...V.staticIp.shape.action.options.map((action) => `static-ip-${action}`),
    "setup",
    "refresh",
    "add-account",
    "delete-account",
    "launch",
    "launch-network",
    "operation-complete",
    "rotate-ip-rollback",
    "rotate-ip-cleanup",
    "open-port",
    "close-port",
    "download-default-key",
    "ssh-connect",
    "traffic-limit",
    "traffic-auto-stop",
    "traffic-auto-stop-check",
  ];
  for (const action of actions) {
    const label = auditActionLabel(action);
    assert.match(label, /\p{Script=Han}/u, action);
    assert.ok(!label.startsWith("其他操作"), action);
  }
  assert.equal(auditActionLabel("enable-ipv6"), "启用 IPv6");
  assert.equal(auditActionLabel("ssh-connect"), "SSH 终端");
  assert.equal(auditActionLabel("static-ip-attach"), "绑定静态 IP");
  assert.equal(auditActionLabel("启动实例"), "启动实例");
  assert.equal(auditActionLabel("future-action"), "其他操作（future-action）");
  assert.equal(auditActionLabel("toString"), "其他操作（toString）");
});

test("clearing deletes hidden audit records and preserves other persistent data", (t) => {
  const store = fixture(t);
  store.setPassword("audit-test-password");
  const session = store.createSession();
  const account = store.saveAccount(
    { name: "test", region: "us-east-1" },
    {
      authType: "keys",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
    },
  );
  const rule = { key: "rule", accountId: account.id, enabled: false };
  const job = { id: "job", status: "complete", at: Date.now() };
  store.saveTrafficLimit(rule);
  store.saveLaunchNetwork(job);
  for (let i = 0; i < 250; i++)
    store.audit({ action: "start", target: `instance-${i}` });
  assert.equal(store.logs().length, 200);
  assert.equal(store.clearLogs(), 250);
  assert.deepEqual(store.logs(), []);
  assert.equal(store.clearLogs(), 0);
  assert.ok(store.session(session.token));
  assert.ok(store.verifyPassword("audit-test-password"));
  assert.equal(
    store.account(account.id).credentials.secretAccessKey,
    "test-secret",
  );
  assert.deepEqual(store.trafficLimit(rule.key), rule);
  assert.deepEqual(store.launchNetwork(job.id), job);
  store.audit({ action: "stop", target: "new-operation" });
  assert.equal(store.logs()[0].target, "new-operation");
});

test("audit deletion requires session, CSRF and trusted origin without invalidating AWS reads", async (t) => {
  const store = fixture(t);
  store.setPassword("audit-test-password");
  const session = store.createSession();
  for (let i = 0; i < 230; i++) store.audit({ action: "start" });
  let scans = 0;
  const gateway = {
    async scan() {
      scans++;
      return { items: [], errors: [] };
    },
  };
  const server = createApp(store, gateway, {
    dist: "missing-dist",
    publicOrigin: "",
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(
    () =>
      new Promise((r) => {
        server.close(r);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = { Cookie: `panel_session=${session.token}` };
  const authenticated = {
    ...cookie,
    "X-CSRF-Token": session.csrf,
    Origin: base,
  };
  const get = (path) => fetch(base + path, { headers: cookie });
  const remove = (headers = {}) =>
    fetch(base + "/api/audit", { method: "DELETE", headers });
  assert.equal((await fetch(base + "/api/audit")).status, 401);
  assert.equal((await remove()).status, 401);
  assert.equal((await remove(cookie)).status, 403);
  assert.equal(
    (await remove({ ...authenticated, "X-CSRF-Token": "wrong" })).status,
    403,
  );
  assert.equal(
    (await remove({ ...authenticated, Origin: "https://untrusted.example" }))
      .status,
    403,
  );
  assert.equal(
    (await remove({ ...authenticated, "Sec-Fetch-Site": "cross-site" })).status,
    403,
  );
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM audit").get().n,
    230,
  );
  const instances =
    "/api/instances?accountId=all&service=lightsail&region=us-east-1";
  assert.equal((await get(instances)).status, 200);
  assert.equal(scans, 1);
  const result = await remove(authenticated);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { deleted: 230 });
  assert.deepEqual(await (await get("/api/audit")).json(), { items: [] });
  assert.equal((await get(instances)).status, 200);
  assert.equal(scans, 1);
  assert.deepEqual(await (await remove(authenticated)).json(), { deleted: 0 });
  store.audit({ action: "ssh-connect", target: "new-session" });
  const { items } = await (await get("/api/audit")).json();
  assert.equal(items.length, 1);
  assert.equal(items[0].action, "ssh-connect");
});
