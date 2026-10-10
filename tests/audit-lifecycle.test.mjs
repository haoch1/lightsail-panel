import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { Store } from "../server/store.mjs";
import { AwsGateway } from "../server/aws.mjs";
import { LaunchNetworkQueue } from "../server/launch-network.mjs";
import { routeContext } from "../server/http/context.mjs";
import { createApp } from "../server/app.mjs";

function fixture(t) {
  const root = resolve("../90_临时/lightsail-panel-audit");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "lifecycle-"));
  let store = new Store(dir);
  const account = store.saveAccount({ name: "test", region: "us-east-1" }, {});
  const gateway = new AwsGateway(store);
  const target = {
    accountId: account.id,
    region: "us-east-1",
    id: "instance",
    service: "lightsail",
  };
  let queue = new LaunchNetworkQueue(store, gateway);
  t.after(() => {
    store.close();
    assert.equal(
      resolve(dir).startsWith(resolve(root) + "/") ||
        resolve(dir).startsWith(resolve(root) + "\\"),
      true,
    );
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    gateway,
    target,
    get store() {
      return store;
    },
    get queue() {
      return queue;
    },
    get audited() {
      return routeContext(store).audited;
    },
    run(
      action,
      input = {},
      result = { operations: [{ id: "op", status: "Started" }] },
      resource = "instances",
    ) {
      return this.audited(action, target.id, target.accountId, (auditId) =>
        queue.run(
          { ...target, ...input, action },
          resource,
          async () => result,
          auditId,
        ),
      );
    },
    reopen() {
      store.close();
      store = new Store(dir);
      gateway.store = store;
      queue = new LaunchNetworkQueue(store, gateway);
    },
  };
}

test("HTTP firewall operations update one original audit row with confirmed rule details", async (t) => {
  const f = fixture(t);
  const session = f.store.createSession();
  const portInfo = {
    protocol: "tcp",
    fromPort: 443,
    toPort: 443,
    cidrs: ["0.0.0.0/0"],
    ipv6Cidrs: ["::/0"],
  };
  f.gateway.updatePorts = async () => ({
    operation: { id: "op", status: "Started" },
    notice: "端口规则已提交，正在跟踪更新结果",
  });
  f.gateway.send = async (_a, _s, _r, command) =>
    command === "GetOperation"
      ? { operation: { status: "Succeeded" } }
      : { portStates: [{ ...portInfo, state: "open" }] };
  const app = createApp(f.store, f.gateway, {
    dist: "missing-dist",
    publicOrigin: "",
  });
  // Drive the persisted job deterministically rather than waiting for the interval.
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(
    () =>
      new Promise((r) => {
        server.close(r);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + "/api/ports", {
    method: "POST",
    headers: {
      Cookie: `panel_session=${session.token}`,
      "X-CSRF-Token": session.csrf,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...f.target, portInfo }),
  });
  assert.equal(response.status, 200);
  const original = f.store.logs()[0];
  assert.equal(original.status, "submitted");
  const job = f.store.launchNetworks({ pendingOnly: true })[0];
  assert.equal(job.auditId, original.id);
  await f.queue.tick();
  const [final] = f.store.logs();
  assert.equal(f.store.logs().length, 1);
  assert.equal(final.id, original.id);
  assert.equal(final.at, original.at);
  assert.equal(final.action, "open-port");
  assert.equal(final.status, "success");
  assert.match(final.detail, /已确认开放 TCP 443/);
  assert.match(final.detail, /0\.0\.0\.0\/0.*::\/0/);
  assert.ok(!final.detail.includes("已提交"));
});

for (const failure of ["AWS failure", "timeout"]) {
  test(`${failure} updates the original action with a failure reason`, async (t) => {
    const f = fixture(t);
    const result = await f.run("enable-ipv6");
    const original = f.store.logs()[0];
    if (failure === "timeout") {
      const job = f.store.launchNetwork(result.networkJob.id);
      job.deadline = 0;
      f.store.saveLaunchNetwork(job);
    }
    f.gateway.send = async () => ({
      operation: { status: "Failed", errorDetails: "AccessDenied: denied" },
    });
    await f.queue.tick();
    const [final] = f.store.logs();
    assert.equal(f.store.logs().length, 1);
    assert.equal(final.id, original.id);
    assert.equal(final.action, "enable-ipv6");
    assert.equal(final.status, "failed");
    assert.match(
      final.detail,
      failure === "timeout" ? /状态更新超时/ : /AccessDenied/,
    );
    await f.queue.tick();
    assert.equal(f.store.logs().length, 1);
  });
}

test("immediate rejection and unchanged operations each have one nonempty audit entry", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.audited("stop", f.target.id, f.target.accountId, async () => {
      throw Error("secretAccessKey=private-value 请求被拒绝");
    }),
  );
  const failed = f.store.logs()[0];
  assert.equal(failed.status, "failed");
  assert.match(failed.detail, /请求被拒绝/);
  assert.ok(!failed.detail.includes("private-value"));
  await f.run(
    "open-port",
    {},
    { unchanged: true, notice: "现有规则已允许该端口，无需重复开放" },
    "ports",
  );
  assert.equal(f.store.logs().length, 2);
  assert.ok(f.store.logs().every((entry) => entry.detail));
  assert.equal(
    f.store.logs().find((entry) => entry.action === "open-port").status,
    "success",
  );
  assert.equal(f.store.launchNetworks().length, 0);
});

test("completion before the HTTP callback returns cannot regress success to processing", async (t) => {
  const f = fixture(t);
  const events = [];
  f.store.onEvent.add((type) => events.push(type));
  f.gateway.send = async () => ({ instance: { state: { name: "stopped" } } });
  await f.audited("stop", f.target.id, f.target.accountId, async (auditId) => {
    const result = await f.queue.run(
      { ...f.target, action: "stop" },
      "instances",
      async () => ({}),
      auditId,
    );
    await f.queue.tick();
    return result;
  });
  assert.equal(f.store.logs().length, 1);
  assert.equal(f.store.logs()[0].status, "success");
  assert.match(f.store.logs()[0].detail, /已停止/);
  assert.equal(events.filter((type) => type === "audit").length, 2);
});

test("restart resumes the persisted audit identity without a second completion record", async (t) => {
  const f = fixture(t);
  await f.run("start");
  const original = f.store.logs()[0];
  f.reopen();
  f.gateway.send = async (_a, _s, _r, command) =>
    command === "GetOperation"
      ? { operation: { status: "Succeeded" } }
      : { instance: { state: { name: "running" } } };
  await f.queue.tick();
  assert.equal(f.store.logs().length, 1);
  assert.equal(f.store.logs()[0].id, original.id);
  assert.equal(f.store.logs()[0].status, "success");
  assert.match(f.store.logs()[0].detail, /运行中/);
});

test("cleared or evicted processing entries are never recreated on completion", async (t) => {
  const f = fixture(t);
  const result = await f.run("start");
  f.store.clearLogs();
  const otherId = f.store.audit({ action: "start", target: f.target.id });
  f.gateway.send = async (_a, _s, _r, command) =>
    command === "GetOperation"
      ? { operation: { status: "Succeeded" } }
      : { instance: { state: { name: "running" } } };
  await f.queue.tick();
  assert.equal(f.store.launchNetwork(result.networkJob.id).status, "success");
  assert.equal(f.store.logs().length, 1);
  assert.equal(f.store.logs()[0].id, otherId);
  const staleId = f.store.audit({ action: "stop", status: "submitted" });
  f.store.db.prepare("DELETE FROM audit WHERE id=?").run(staleId);
  assert.equal(
    f.store.updateAudit(staleId, { status: "success", detail: "已停止" }),
    0,
  );
  assert.equal(f.store.logs().length, 1);
});

test("batch creation aggregates individual outcomes in the original creation entry", async (t) => {
  const f = fixture(t);
  const input = {
    ...f.target,
    token: "batch",
    name: "batch-instance",
    count: 2,
  };
  await f.audited("launch", input.name, input.accountId, async (auditId) => ({
    networkJob: f.queue.enqueue(
      input,
      {
        operations: [
          { id: "one", resourceName: "batch-instance-1" },
          { id: "two", resourceName: "batch-instance-2" },
        ],
      },
      auditId,
    ),
  }));
  f.gateway.send = async (_a, _s, _r, command, input) =>
    command === "GetOperation"
      ? {
          operation:
            input.operationId === "one"
              ? { status: "Succeeded" }
              : { status: "Failed", errorDetails: "创建配额不足" },
        }
      : { instance: { state: { name: "running" } } };
  await f.queue.tick();
  assert.equal(f.store.logs().length, 1);
  const [entry] = f.store.logs();
  assert.equal(entry.action, "launch");
  assert.equal(entry.target, "batch-instance");
  assert.equal(entry.status, "failed");
  assert.match(entry.detail, /batch-instance-1：实例已运行/);
  assert.match(entry.detail, /batch-instance-2：创建配额不足/);
});

test("separate attempts on the same resource keep independent identities and outcomes", async (t) => {
  const f = fixture(t);
  await f.run("stop");
  await assert.rejects(f.run("stop"), (e) => e.status === 409);
  f.gateway.send = async (_a, _s, _r, command) =>
    command === "GetOperation"
      ? { operation: { status: "Succeeded" } }
      : { instance: { state: { name: "stopped" } } };
  await f.queue.tick();
  assert.equal(f.store.logs().length, 2);
  assert.equal(new Set(f.store.logs().map((entry) => entry.id)).size, 2);
  assert.deepEqual(
    f.store
      .logs()
      .map((entry) => entry.status)
      .sort(),
    ["failed", "success"],
  );
  assert.match(
    f.store.logs().find((entry) => entry.status === "failed").detail,
    /上一项操作尚未完成/,
  );
});

test("account validation and failed protection settings record concrete outcomes without credentials", async (t) => {
  const f = fixture(t);
  const session = f.store.createSession();
  f.gateway.identity = async () => ({ awsAccountId: "123456789012" });
  const server = createApp(f.store, f.gateway, {
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
  const request = (path, body = {}, method = "POST") =>
    fetch(base + "/api" + path, {
      method,
      headers: {
        Cookie: `panel_session=${session.token}`,
        "X-CSRF-Token": session.csrf,
        Origin: base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const added = await request("/accounts", {
    name: "new-account",
    accessKeyId: "test-key",
    secretAccessKey: "private-account-secret",
  });
  assert.equal(added.status, 201);
  const { id } = await added.json();
  assert.equal((await request(`/accounts/${id}/verify`)).status, 200);
  f.gateway.identity = async () => {
    throw Error("AWS 身份校验失败");
  };
  assert.equal((await request(`/accounts/${id}/verify`)).status, 502);
  f.gateway.send = async () => {
    throw Error("GetInstance 权限不足");
  };
  assert.equal(
    (
      await request("/traffic-limit", {
        ...f.target,
        enabled: true,
        thresholdPercent: 90,
      })
    ).status,
    502,
  );
  assert.equal((await request(`/accounts/${id}`, {}, "DELETE")).status, 200);
  const logs = f.store.logs();
  assert.equal(logs.length, 5);
  assert.equal(logs.filter((entry) => entry.status === "failed").length, 2);
  assert.ok(logs.every((entry) => entry.detail));
  assert.ok(
    logs.some(
      (entry) =>
        entry.action === "add-account" && /账户配置已保存/.test(entry.detail),
    ),
  );
  assert.ok(
    logs.some(
      (entry) =>
        entry.action === "verify-account" && /校验失败/.test(entry.detail),
    ),
  );
  assert.ok(
    logs.some(
      (entry) =>
        entry.action === "traffic-limit" &&
        /GetInstance 权限不足/.test(entry.detail),
    ),
  );
  assert.ok(!JSON.stringify(logs).includes("private-account-secret"));
});
