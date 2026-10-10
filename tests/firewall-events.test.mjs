import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { AwsGateway } from "../server/aws.mjs";
import { Store } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { LaunchNetworkQueue } from "../server/launch-network.mjs";
import { publicPorts } from "../server/validation.mjs";
import { routeContext } from "../server/http/context.mjs";
import {
  cidrContains,
  portRuleCovered,
  portRulePresent,
} from "../shared/firewall.ts";
import { bytes, when } from "../src/lib/format.ts";

const all = {
  protocol: "-1",
  fromPort: 0,
  toPort: 65535,
  cidrs: ["0.0.0.0/0"],
  ipv6Cidrs: ["::/0"],
};
const tcp = { ...all, protocol: "tcp" };
function fixture(t) {
  const root = resolve("../90_临时/lightsail-panel-polish");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "test-"));
  const store = new Store(dir);
  const account = store.saveAccount(
    { name: "test", region: "us-east-1" },
    { accessKeyId: "fake", secretAccessKey: "fake" },
  );
  const gateway = new AwsGateway(store);
  t.after(() => {
    store.close();
    assert.ok(dir.startsWith(root + "/") || dir.startsWith(root + "\\"));
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    store,
    gateway,
    target: {
      accountId: account.id,
      region: "us-east-1",
      service: "lightsail",
      id: "test-instance",
    },
  };
}
test("AWS numeric protocols normalize to documented request values; unrelated values remain invalid", () => {
  for (const [raw, protocol] of [
    ["-1", "all"],
    [-1, "all"],
    [6, "tcp"],
    [17, "udp"],
    [1, "icmp"],
    [58, "icmpv6"],
  ]) {
    const rule = publicPorts.parse({
      accountId: "a",
      region: "us-east-1",
      id: "i",
      close: true,
      portInfo: {
        ...all,
        protocol: raw,
        ...(protocol.startsWith("icmp") ? { fromPort: -1, toPort: -1 } : {}),
      },
    });
    assert.equal(rule.portInfo.protocol, protocol);
  }
  assert.equal(
    publicPorts.safeParse({
      accountId: "a",
      region: "us-east-1",
      id: "i",
      close: true,
      portInfo: { ...all, protocol: "99" },
    }).success,
    false,
  );
});
test("coverage handles all protocols, wider ranges, normalized CIDRs and separate IP families", () => {
  assert.ok(portRuleCovered([all], tcp));
  assert.ok(
    portRuleCovered(
      [
        { ...all, ipv6Cidrs: [] },
        { ...all, cidrs: [] },
      ],
      tcp,
    ),
  );
  assert.equal(portRuleCovered([{ ...all, ipv6Cidrs: [] }], tcp), false);
  assert.equal(
    portRuleCovered([{ ...tcp, fromPort: 80, toPort: 80 }], tcp),
    false,
  );
  assert.ok(cidrContains("192.0.2.128/24", "192.0.2.5/32"));
  assert.ok(cidrContains("2001:0db8:0000:0000::/64", "2001:db8::1234/128"));
  assert.ok(cidrContains("::ffff:192.0.2.0/120", "::ffff:c000:0201/128"));
  assert.equal(cidrContains("2001:db8::/64", "2001:db9::/64"), false);
  assert.equal(cidrContains("::/0", "0.0.0.0/0"), false);
  assert.ok(
    portRuleCovered(
      [{ ...tcp, cidrs: ["192.0.2.0/24"], ipv6Cidrs: ["2001:db8::/64"] }],
      {
        ...tcp,
        fromPort: 22,
        toPort: 22,
        cidrs: ["192.0.2.7/32"],
        ipv6Cidrs: ["2001:db8::8/128"],
      },
    ),
  );
  assert.equal(
    portRulePresent([all], tcp),
    false,
    "closing TCP must not remove a separate all-protocol rule",
  );
  assert.ok(portRulePresent([all], { ...all, protocol: "all" }));
});
test("covered openings skip AWS writes; all-protocol closure sends all and retains both source families", async (t) => {
  const { gateway, target } = fixture(t);
  const calls = [];
  gateway.send = async (_a, _s, _r, command, input) => {
    calls.push({ command, input });
    if (command === "GetInstancePortStates")
      return { portStates: [{ ...all, state: "open" }] };
    return { operation: { id: "op", status: "Started" } };
  };
  const listing = await gateway.ports(target);
  assert.equal(listing.items[0].protocol, "all");
  const unchanged = await gateway.updatePorts({ ...target, portInfo: tcp });
  assert.equal(unchanged.unchanged, true);
  assert.equal(
    calls.some((c) => c.command === "OpenInstancePublicPorts"),
    false,
  );
  await gateway.updatePorts(
    publicPorts.parse({ ...target, close: true, portInfo: all }),
  );
  const close = calls.find((c) => c.command === "CloseInstancePublicPorts");
  assert.deepEqual(close.input.portInfo, { ...all, protocol: "all" });
});
test("firewall observations complete under covering rules and report operation failures and timeouts", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { store, gateway, target } = fixture(t);
  const queue = new LaunchNetworkQueue(store, gateway);
  let rules = [{ ...all, state: "open" }];
  let status = "Succeeded";
  gateway.send = async (_a, _s, _r, command) =>
    command === "GetOperation"
      ? { operation: { status, errorDetails: "denied" } }
      : { portStates: rules };
  let job = queue.watch(
    { ...target, action: "open-port", portInfo: tcp },
    { operations: [{ id: "op" }] },
    "ports",
  );
  await queue.tick();
  assert.equal(store.launchNetwork(job.id).status, "success");
  assert.ok(queue.view(store.launchNetwork(job.id)).completedAt);
  job = queue.watch(
    {
      ...target,
      action: "close-port",
      close: true,
      portInfo: { ...all, protocol: "all" },
    },
    {},
    "ports",
  );
  await queue.tick();
  assert.equal(store.launchNetwork(job.id).status, "pending");
  rules = [];
  t.mock.timers.tick(15000);
  await queue.tick();
  assert.equal(store.launchNetwork(job.id).status, "success");
  status = "Failed";
  job = queue.watch(
    { ...target, action: "open-port", portInfo: tcp },
    { operations: [{ id: "bad" }] },
    "ports",
  );
  await queue.tick();
  assert.equal(store.launchNetwork(job.id).status, "failed");
  assert.match(store.launchNetwork(job.id).instances[0].detail, /denied/);
  job = queue.watch(
    { ...target, action: "open-port", portInfo: tcp },
    {},
    "ports",
  );
  t.mock.timers.tick(601000);
  await queue.tick();
  assert.equal(store.launchNetwork(job.id).status, "failed");
  assert.match(store.launchNetwork(job.id).instances[0].detail, /超时/);
});
test("resource submission lock blocks concurrent writes and pending follow-ups without calling AWS", async (t) => {
  const { store, gateway, target } = fixture(t);
  const queue = new LaunchNetworkQueue(store, gateway);
  let done,
    calls = 0;
  const first = queue.run(
    { ...target, action: "enable-ipv6" },
    "instances",
    () => {
      calls++;
      return new Promise((r) => {
        done = r;
      });
    },
  );
  await assert.rejects(
    queue.run({ ...target, action: "close-port" }, "ports", () => {
      calls++;
    }),
    (e) => e.status === 409,
  );
  done({ operations: [{ id: "op" }] });
  assert.equal((await first).networkJob.status, "pending");
  await assert.rejects(
    queue.run({ ...target, action: "stop" }, "instances", () => {
      calls++;
    }),
    (e) => e.status === 409,
  );
  assert.equal(calls, 1);
  const job = store.launchNetworks({ pendingOnly: true })[0];
  job.status = "success";
  store.saveLaunchNetwork(job);
  await queue.run({ ...target, action: "open-port" }, "ports", async () => ({
    unchanged: true,
  }));
  assert.equal(store.launchNetworks({ pendingOnly: true }).length, 0);
});
test("accepted writes remain submitted until resource confirmation and protect their related instance", async (t) => {
  const { store, gateway, target } = fixture(t);
  const queue = new LaunchNetworkQueue(store, gateway);
  const { audited } = routeContext(store);
  const result = await audited(
    "static-ip-attach",
    "ip",
    target.accountId,
    (auditId) =>
      queue.run(
        {
          ...target,
          id: undefined,
          name: "ip",
          instanceName: target.id,
          action: "attach",
        },
        "static-ips",
        async () => ({ operations: [{ id: "op", status: "Succeeded" }] }),
        auditId,
      ),
  );
  assert.equal(result.networkJob.status, "pending");
  assert.equal(result.networkJob.targetInstance, target.id);
  assert.equal(store.logs()[0].status, "submitted");
  const original = store.logs()[0];
  await assert.rejects(
    queue.run({ ...target, action: "stop" }, "instances", () => {
      throw Error("conflicting AWS write must not run");
    }),
    (e) => e.status === 409,
  );
  gateway.send = async (_a, _s, _r, command) =>
    command === "GetOperation"
      ? { operation: { status: "Succeeded" } }
      : { staticIp: { attachedTo: target.id } };
  await queue.tick();
  assert.equal(store.launchNetwork(result.networkJob.id).status, "success");
  assert.equal(store.logs()[0].status, "success");
  assert.equal(store.logs().length, 1);
  assert.equal(store.logs()[0].id, original.id);
  assert.equal(store.logs()[0].at, original.at);
  assert.equal(store.logs()[0].action, "static-ip-attach");
  assert.match(store.logs()[0].detail, new RegExp(target.id));
});

test("authenticated events immediately signal logs, cleanup and operation status without AWS polling", async (t) => {
  const { store, gateway, target } = fixture(t);
  const session = store.createSession();
  gateway.send = async () => {
    throw Error("events must not query AWS");
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
  assert.equal((await fetch(base + "/api/events")).status, 401);
  const headers = { Cookie: `panel_session=${session.token}` };
  assert.equal(
    (
      await fetch(base + "/api/events", {
        headers: { ...headers, "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
  const abort = new AbortController();
  const response = await fetch(base + "/api/events", {
    headers,
    signal: abort.signal,
  });
  const reader = response.body.getReader();
  const read = async () =>
    new TextDecoder().decode((await reader.read()).value);
  assert.match(await read(), /data: ready/);
  store.audit({ action: "ssh-connect", target: "test" });
  assert.equal(await read(), "data: audit\n\n");
  store.clearLogs();
  assert.equal(await read(), "data: audit\n\n");
  const queue = new LaunchNetworkQueue(store, gateway);
  queue.watch({ ...target, action: "stop" }, {});
  assert.equal(await read(), "data: operations\n\n");
  store.deleteSession(session.token);
  store.audit({ action: "start" });
  assert.equal((await reader.read()).done, true);
  assert.equal(store.onEvent.size, 0);
  abort.abort();
});
test("traffic display uses familiar uppercase units and refresh timestamps omit seconds", () => {
  for (const [power, unit] of ["B", "KB", "MB", "GB", "TB"].entries())
    assert.equal(bytes(1024 ** power), `1.00 ${unit}`);
  assert.equal(bytes(3 * 1024 ** 4), "3.00 TB");
  assert.equal(bytes(0), "0.00 B");
  assert.match(
    when("2026-10-10T14:50:59Z"),
    /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/,
  );
});
