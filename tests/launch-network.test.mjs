import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createApp } from "../server/app.mjs";
import { AwsGateway } from "../server/aws.mjs";
import { LaunchNetworkQueue } from "../server/launch-network.mjs";
import { Store } from "../server/store.mjs";
import { launch } from "../server/validation.mjs";

const rule = {
  protocol: "tcp",
  fromPort: 22,
  toPort: 22,
  cidrs: ["198.51.100.1/32"],
  ipv6Cidrs: ["2001:db8::/64"],
};
function fixture(t) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const queueFor = (store, gateway) => {
    const queue = new LaunchNetworkQueue(store, gateway);
    const tick = queue.tick.bind(queue);
    queue.tick = async () => {
      t.mock.timers.tick(15000);
      await tick();
    };
    return queue;
  };
  const root = resolve("../aws-panel-reference");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "network-test-"));
  let store = new Store(dir);
  const account = store.saveAccount(
    { name: "test", region: "us-east-1" },
    { authType: "default" },
  );
  const gateway = new AwsGateway(store);
  const input = launch.parse({
    accountId: account.id,
    region: "us-east-1",
    name: "new-instance",
    imageId: "debian_13",
    instanceType: "small",
    count: 1,
    token: randomUUID(),
    firewall: [rule],
    allocateStaticIp: true,
    userData: "echo PRIVATE_SCRIPT",
  });
  const calls = [],
    ips = new Map();
  let running = true,
    status = "Succeeded";
  gateway.send = async (_a, _s, region, command, data) => {
    assert.equal(region, input.region);
    calls.push({ command, data });
    if (command === "GetOperation") return { operation: { status } };
    if (command === "GetInstance")
      return { instance: { state: { name: running ? "running" : "pending" } } };
    if (command === "PutInstancePublicPorts")
      return { operation: { id: "firewall-op" } };
    if (command === "GetStaticIp") {
      if (!ips.has(data.staticIpName))
        throw Object.assign(Error("missing"), { name: "NotFoundException" });
      return { staticIp: ips.get(data.staticIpName) };
    }
    if (command === "AllocateStaticIp") {
      ips.set(data.staticIpName, { isAttached: false });
      return { operations: [{ id: "allocate-op" }] };
    }
    if (command === "AttachStaticIp") {
      ips.set(data.staticIpName, {
        attachedTo: data.instanceName,
        isAttached: true,
      });
      return { operations: [{ id: "attach-op" }] };
    }
    if (command === "ReleaseStaticIp") {
      ips.delete(data.staticIpName);
      return {};
    }
    throw Error(`Unexpected command ${command}`);
  };
  let queue = queueFor(store, gateway);
  t.after(() => {
    store.close();
    assert.ok(dir.startsWith(root + "\\") || dir.startsWith(root + "/"));
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    get queue() {
      return queue;
    },
    gateway,
    input,
    calls,
    ips,
    setRunning: (v) => {
      running = v;
    },
    setStatus: (v) => {
      status = v;
    },
    reopen() {
      store.close();
      store = new Store(dir);
      gateway.store = store;
      queue = queueFor(store, gateway);
    },
  };
}
async function finish(f) {
  for (
    let i = 0;
    i < 12 && f.store.launchNetwork(f.input.token).status === "pending";
    i++
  )
    await f.queue.tick();
  return f.store.launchNetwork(f.input.token);
}

test("partial batch completion invalidates the affected scope before all instances finish", async (t) => {
  const f = fixture(t),
    updated = [];
  f.input.count = 2;
  delete f.input.firewall;
  f.input.allocateStaticIp = false;
  f.queue.invalidate = (job) =>
    updated.push({
      accountId: job.accountId,
      region: job.region,
      status: job.status,
    });
  f.gateway.send = async (_account, _service, _region, command, data) => {
    assert.equal(command, "GetInstance");
    return {
      instance: {
        state: {
          name: data.instanceName.endsWith("-1") ? "running" : "pending",
        },
      },
    };
  };
  f.queue.enqueue(f.input, {});
  await f.queue.tick();
  const job = f.store.launchNetwork(f.input.token);
  assert.equal(job.status, "pending");
  assert.equal(job.instances[0].stage, "done");
  assert.equal(job.instances[1].stage, "instance");
  assert.deepEqual(updated, [
    { accountId: f.input.accountId, region: f.input.region, status: "pending" },
  ]);
  assert.equal(f.store.launchNetworks({ pendingOnly: true }).length, 1);
  assert.equal(
    f.store.launchNetworks({ recentSince: Date.now() + 1 }).length,
    1,
    "pending work remains visible even outside the recent window",
  );
});

test("superseding a watch during an in-flight read cannot resurrect the retired operation", async (t) => {
  const f = fixture(t);
  let unblock, reached;
  const started = new Promise((resolve) => {
    reached = resolve;
  });
  f.gateway.send = async () => {
    reached();
    await new Promise((resolve) => {
      unblock = resolve;
    });
    return { instance: { state: { name: "pending" } } };
  };
  const input = {
    accountId: f.input.accountId,
    region: f.input.region,
    id: f.input.name,
  };
  const first = f.queue.watch({ ...input, action: "start" });
  const working = f.queue.tick();
  await started;
  const second = f.queue.watch({ ...input, action: "stop" });
  unblock();
  await working;
  assert.equal(f.store.launchNetwork(first.id).status, "success");
  assert.deepEqual(
    f.store.launchNetworks({ pendingOnly: true }).map((job) => job.id),
    [second.id],
  );
});

test("port tracking waits for all requested sources and confirms closing only the requested rule", async (t) => {
  const f = fixture(t);
  let portStates = [{ ...rule, state: "open", ipv6Cidrs: [] }];
  f.gateway.send = async (_account, _service, _region, command) => {
    assert.equal(command, "GetInstancePortStates");
    return { portStates };
  };
  const input = {
    accountId: f.input.accountId,
    region: f.input.region,
    id: f.input.name,
    portInfo: rule,
  };
  let job = f.queue.watch({ ...input, action: "open-port" }, {}, "ports");
  f.input.token = job.id;
  await f.queue.tick();
  assert.equal(f.store.launchNetwork(job.id).status, "pending");
  portStates = [{ ...rule, state: "open" }];
  assert.equal((await finish(f)).status, "success");
  job = f.queue.watch(
    { ...input, action: "close-port", close: true },
    {},
    "ports",
  );
  f.input.token = job.id;
  portStates = [
    {
      ...rule,
      state: "open",
      cidrs: ["203.0.113.0/24"],
      ipv6Cidrs: rule.ipv6Cidrs,
    },
  ];
  await f.queue.tick();
  assert.equal(f.store.launchNetwork(job.id).status, "pending");
  portStates = [
    { ...rule, state: "open", cidrs: ["203.0.113.0/24"], ipv6Cidrs: [] },
  ];
  assert.equal(
    (await finish(f)).status,
    "success",
    "unrelated allowed sources must remain intact",
  );
});

test("operation tracking waits for real state, survives restart, and never repeats start or stop", async (t) => {
  const f = fixture(t);
  f.setStatus("Started");
  f.setRunning(false);
  const job = f.queue.watch(
    {
      accountId: f.input.accountId,
      region: f.input.region,
      id: f.input.name,
      action: "start",
    },
    { operations: [{ id: "start-op" }] },
  );
  f.input.token = job.id;
  await f.queue.tick();
  assert.equal(f.store.launchNetwork(job.id).status, "pending");
  f.setStatus("Succeeded");
  await f.queue.tick();
  assert.equal(f.store.launchNetwork(job.id).status, "pending");
  f.reopen();
  f.setRunning(true);
  assert.equal((await finish(f)).status, "success");
  assert.ok(
    f.calls.every((c) => ["GetOperation", "GetInstance"].includes(c.command)),
  );
});

test("later mutations supersede old watches, passive discovery deduplicates, and polling backs off", async (t) => {
  const f = fixture(t);
  f.setRunning(false);
  const input = {
    accountId: f.input.accountId,
    region: f.input.region,
    id: f.input.name,
  };
  const first = f.queue.watch({ ...input, action: "start" });
  assert.equal(
    f.queue.watch({ ...input, action: "start", passive: true }),
    undefined,
  );
  await f.queue.tick();
  const count = f.calls.length;
  await LaunchNetworkQueue.prototype.tick.call(f.queue);
  assert.equal(f.calls.length, count);
  t.mock.timers.tick(60000);
  await LaunchNetworkQueue.prototype.tick.call(f.queue);
  assert.equal(
    f.store.launchNetwork(first.id).instances[0].nextCheck - Date.now(),
    15000,
  );
  const second = f.queue.watch({ ...input, action: "stop" });
  assert.equal(f.store.launchNetwork(first.id).status, "success");
  assert.notEqual(first.id, second.id);
});

test("deletion, IPv6, static IP and firewall watchers confirm target resources without scanning regions", async (t) => {
  const f = fixture(t);
  const native = f.gateway.send;
  let exists = true,
    network = "ipv4",
    attached = true;
  f.gateway.send = async (...args) => {
    const command = args[3];
    f.calls.push({ command, data: args[4] });
    if (command === "GetInstance") {
      if (!exists)
        throw Object.assign(Error("missing"), { name: "NotFoundException" });
      return {
        instance: {
          state: { name: "running" },
          ipAddressType: network,
          ipv6Addresses: network === "dualstack" ? ["2001:db8::1"] : [],
        },
      };
    }
    if (command === "GetStaticIp")
      return {
        staticIp: {
          isAttached: attached,
          attachedTo: attached ? "new-instance" : undefined,
        },
      };
    if (command === "GetInstancePortStates") return { portStates: [] };
    return native(...args);
  };
  const base = {
    accountId: f.input.accountId,
    region: f.input.region,
    id: f.input.name,
  };
  let job = f.queue.watch({ ...base, action: "enable-ipv6" });
  f.input.token = job.id;
  await f.queue.tick();
  assert.equal(f.store.launchNetwork(job.id).status, "pending");
  network = "dualstack";
  assert.equal((await finish(f)).status, "success");
  job = f.queue.watch({ ...base, action: "terminate" });
  f.input.token = job.id;
  await f.queue.tick();
  assert.equal(f.store.launchNetwork(job.id).status, "pending");
  exists = false;
  assert.equal((await finish(f)).status, "success");
  job = f.queue.watch(
    { ...base, id: undefined, name: "test-ip", action: "detach" },
    {},
    "static-ips",
  );
  f.input.token = job.id;
  await f.queue.tick();
  assert.equal(f.store.launchNetwork(job.id).status, "pending");
  attached = false;
  assert.equal((await finish(f)).status, "success");
  job = f.queue.watch({ ...base, action: "close-port" }, {}, "ports");
  f.input.token = job.id;
  assert.equal((await finish(f)).status, "success");
  assert.ok(
    !f.calls.some((c) =>
      ["GetRegions", "GetInstances", "GetStaticIps"].includes(c.command),
    ),
  );
});

test("creation without optional network settings is still tracked until running", async (t) => {
  const f = fixture(t);
  delete f.input.firewall;
  f.input.allocateStaticIp = false;
  f.setRunning(false);
  f.queue.enqueue(f.input, {});
  await f.queue.tick();
  assert.equal(f.store.launchNetwork(f.input.token).status, "pending");
  f.setRunning(true);
  assert.equal((await finish(f)).status, "success");
  assert.deepEqual(
    f.calls.map((c) => c.command),
    ["GetInstance", "GetInstance"],
  );
});

test("a failed observation stops automatic retries until manual refresh or a new operation", async (t) => {
  const f = fixture(t);
  const input = {
    accountId: f.input.accountId,
    region: f.input.region,
    id: f.input.name,
    action: "start",
    passive: true,
  };
  const first = f.queue.watch(input),
    saved = f.store.launchNetwork(first.id);
  saved.deadline = 0;
  f.store.saveLaunchNetwork(saved);
  await f.queue.tick();
  assert.equal(f.store.launchNetwork(first.id).status, "failed");
  assert.equal(f.queue.watch(input), undefined);
  assert.ok(f.queue.watch({ ...input, retry: true }));
  assert.equal(f.store.launchNetworks({ pendingOnly: true }).length, 1);
});

test("launch rejects invalid network options before submitting AWS creation", () => {
  const input = {
    accountId: "test",
    region: "us-east-1",
    name: "new-instance",
    imageId: "debian",
    instanceType: "small",
    token: randomUUID(),
  };
  assert.equal(launch.parse(input).allocateStaticIp, false);
  assert.equal(launch.parse(input).firewall, undefined);
  for (const invalid of [
    { firewall: [] },
    { firewall: [{ ...rule, fromPort: 100, toPort: 50 }] },
    { firewall: [{ ...rule, cidrs: ["198.51.100.1/33"] }] },
    { firewall: [{ ...rule, cidrs: [], ipv6Cidrs: [] }] },
    { ipAddressType: "ipv6", allocateStaticIp: true },
    { ipAddressType: "ipv6", firewall: [rule] },
    { ipAddressType: "ipv4", firewall: [rule] },
  ])
    assert.equal(
      launch.safeParse({ ...input, ...invalid }).success,
      false,
      JSON.stringify(invalid),
    );
  assert.ok(
    launch.safeParse({
      ...input,
      ipAddressType: "ipv6",
      firewall: [{ ...rule, cidrs: [] }],
    }).success,
  );
});

test("network queue waits for creation and all operations, then sets exact firewall and binds each address", async (t) => {
  const f = fixture(t);
  f.input.count = 2;
  f.setStatus("Started");
  f.setRunning(false);
  f.queue.enqueue(f.input, {
    operations: [
      { id: "create-one", resourceName: "new-instance-1" },
      { id: "create-two", resourceName: "new-instance-2" },
    ],
  });
  await f.queue.tick();
  assert.ok(f.calls.every((c) => c.command === "GetOperation"));
  f.setStatus("Succeeded");
  await f.queue.tick();
  assert.ok(!f.calls.some((c) => c.command === "PutInstancePublicPorts"));
  f.setRunning(true);
  await f.queue.tick();
  await f.queue.tick();
  f.setStatus("Started");
  await f.queue.tick();
  assert.ok(!f.calls.some((c) => c.command === "AllocateStaticIp"));
  f.setStatus("Succeeded");
  const job = await finish(f);
  assert.equal(job.status, "success");
  assert.deepEqual(
    f.calls
      .filter((c) => c.command === "PutInstancePublicPorts")
      .map((c) => c.data),
    ["new-instance-1", "new-instance-2"].map((name) => ({
      instanceName: name,
      portInfos: [rule],
    })),
  );
  assert.equal(
    f.calls.filter((c) => c.command === "AllocateStaticIp").length,
    2,
  );
  assert.equal(f.calls.filter((c) => c.command === "AttachStaticIp").length, 2);
  for (const [index, item] of job.instances.entries())
    assert.equal(
      f.ips.get(item.staticIpName).attachedTo,
      `new-instance-${index + 1}`,
    );
  assert.equal(f.store.logs()[0].action, "launch-network");
  assert.ok(!JSON.stringify(job).includes("PRIVATE_SCRIPT"));
  assert.ok(!JSON.stringify(f.queue.view(job)).includes("fingerprint"));
});

test("restart resumes allocated static IP without allocating or creating again", async (t) => {
  const f = fixture(t);
  f.input.firewall = undefined;
  f.queue.enqueue(f.input, {});
  await f.queue.tick();
  await f.queue.tick();
  assert.equal(
    f.store.launchNetwork(f.input.token).instances[0].stage,
    "attach",
  );
  f.reopen();
  const job = await finish(f);
  assert.equal(job.status, "success");
  assert.equal(
    f.calls.filter((c) => c.command === "AllocateStaticIp").length,
    1,
  );
  assert.ok(!f.calls.some((c) => c.command === "CreateInstances"));
});

test("failed creation operation performs no network mutation", async (t) => {
  const f = fixture(t);
  f.setStatus("Failed");
  f.queue.enqueue(f.input, { operations: [{ id: "create" }] });
  const job = await finish(f);
  assert.equal(job.status, "failed");
  assert.deepEqual(
    f.calls.map((c) => c.command),
    ["GetOperation"],
  );
});

test("firewall failure preserves created instance and configures independent instances", async (t) => {
  const f = fixture(t);
  f.input.count = 2;
  const send = f.gateway.send;
  f.gateway.send = async (...args) => {
    if (
      args[3] === "PutInstancePublicPorts" &&
      args[4].instanceName.endsWith("-1")
    )
      throw Error("AccessDenied: PutInstancePublicPorts");
    return send(...args);
  };
  f.queue.enqueue(f.input, {});
  const job = await finish(f);
  assert.equal(job.status, "failed");
  assert.equal(job.instances[0].stage, "failed");
  assert.equal(job.instances[1].stage, "done");
  assert.equal(
    f.calls.filter((c) => c.command === "AllocateStaticIp").length,
    1,
  );
  assert.ok(
    !f.calls.some((c) =>
      ["CreateInstances", "DeleteInstance"].includes(c.command),
    ),
  );
});

test("ambiguous attachment failure retains address; allocation operation failure releases confirmed unused address", async (t) => {
  const f = fixture(t);
  f.input.firewall = undefined;
  const send = f.gateway.send;
  f.gateway.send = async (...args) => {
    if (args[3] === "AttachStaticIp")
      throw Error("Connection closed after submission");
    return send(...args);
  };
  f.queue.enqueue(f.input, {});
  let job = await finish(f);
  assert.equal(job.status, "failed");
  assert.match(job.instances[0].detail, /已保留/);
  assert.equal(f.ips.size, 1);
  assert.ok(!f.calls.some((c) => c.command === "ReleaseStaticIp"));
  f.input.token = randomUUID();
  f.gateway.send = send;
  f.queue.enqueue(f.input, {});
  await f.queue.tick();
  await f.queue.tick();
  f.setStatus("Failed");
  job = await finish(f);
  assert.equal(job.status, "failed");
  assert.equal(
    f.calls.filter((c) => c.command === "ReleaseStaticIp").length,
    1,
  );
  assert.ok(!f.ips.has(job.instances[0].staticIpName));
});

test("timeout reports existing resources without recreating the instance", async (t) => {
  const f = fixture(t);
  f.queue.enqueue(f.input, {});
  const job = f.store.launchNetwork(f.input.token);
  job.deadline = 0;
  f.store.saveLaunchNetwork(job);
  const result = await finish(f);
  assert.equal(result.status, "failed");
  assert.match(result.instances[0].detail, /无需重新创建/);
  assert.equal(f.calls.length, 0);
});

test("launch HTTP persists idempotency across restart and progress reads require auth without AWS calls", async (t) => {
  const f = fixture(t);
  f.setRunning(false);
  let submissions = 0;
  f.gateway.launch = async () => {
    submissions++;
    return { operations: [] };
  };
  let server;
  const open = async () => {
    server = createApp(f.store, f.gateway, {
      dist: resolve("../aws-panel-reference/no-dist"),
    }).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    return `http://127.0.0.1:${server.address().port}/api`;
  };
  let url = await open();
  t.after(() => new Promise((r) => server.close(r)));
  let session = f.store.createSession();
  const headers = () => ({
    "Content-Type": "application/json",
    Cookie: "panel_session=" + session.token,
    "X-CSRF-Token": session.csrf,
  });
  const post = (input = f.input) =>
    fetch(url + "/launch", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(input),
    });
  let response = await post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).networkJob.status, "pending");
  response = await post();
  assert.equal(response.status, 200);
  assert.equal(submissions, 1);
  response = await post({ ...f.input, name: "changed" });
  assert.equal(response.status, 409);
  assert.equal((await fetch(url + "/launch/network")).status, 401);
  const before = f.calls.length;
  response = await fetch(url + "/launch/network", { headers: headers() });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items.length, 1);
  assert.equal(f.calls.length, before);
  await new Promise((r) => server.close(r));
  f.reopen();
  url = await open();
  session = f.store.createSession();
  response = await post();
  assert.equal(response.status, 200);
  assert.equal(submissions, 1);
  assert.ok(
    !JSON.stringify(f.store.launchNetwork(f.input.token)).includes(
      "PRIVATE_SCRIPT",
    ),
  );
});
