import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createApp } from "../server/app.mjs";
import {
  AwsGateway,
  mapLimit,
  modules,
  paginate,
  usedCommands,
} from "../server/aws.mjs";
import { Store } from "../server/store.mjs";
import * as V from "../server/validation.mjs";
const root = resolve("../aws-panel-reference");
mkdirSync(root, { recursive: true });
function fixture(t) {
  const dir = mkdtempSync(join(root, "panel-test-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    assert.ok(dir.startsWith(root + "\\") || dir.startsWith(root + "/"));
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir };
}
test("account credentials are encrypted, authenticated, and never returned by list", (t) => {
  const { store, dir } = fixture(t);
  const key = "test-secret-that-must-not-be-visible";
  const a = store.saveAccount(
    { name: "test", region: "us-east-1" },
    { authType: "keys", accessKeyId: "dummy", secretAccessKey: key },
  );
  assert.equal(store.account(a.id).credentials.secretAccessKey, key);
  assert.equal(store.accounts()[0].credentials, undefined);
  assert.ok(!JSON.stringify(store.accounts()).includes(key));
  const encrypted = store.db
    .prepare("SELECT secret FROM accounts")
    .get().secret;
  assert.ok(!encrypted.includes(key));
  const modified = Buffer.from(encrypted, "base64");
  modified[40] ^= 1;
  assert.throws(() => store.decrypt(modified.toString("base64")));
  assert.equal(readFileSync(join(dir, "encryption.key")).length, 32);
});
test("password and session lifecycle", (t) => {
  const { store } = fixture(t);
  store.setPassword("long-test-password");
  assert.equal(store.verifyPassword("wrong"), false);
  assert.equal(store.verifyPassword("long-test-password"), true);
  const session = store.createSession();
  assert.ok(store.session(session.token));
  assert.ok(
    !JSON.stringify(store.config("admin")).includes("long-test-password"),
  );
  store.setPassword("new-test-password");
  assert.equal(store.session(session.token), null);
});
test("all used commands exist in the currently installed AWS SDK v3", () => {
  for (const [service, names] of Object.entries(usedCommands))
    for (const name of names)
      assert.equal(
        typeof modules[service][name + "Command"],
        "function",
        `${service}:${name}`,
      );
});
test("pagination preserves Lightsail continuation tokens", async () => {
  const calls = [];
  const result = await paginate(async (p) => {
    calls.push(p);
    return p.NextToken ? { items: [2] } : { items: [1], NextToken: "next" };
  }, "items");
  assert.deepEqual(result, [1, 2]);
  assert.deepEqual(calls, [{}, { NextToken: "next" }]);
  const lsCalls = [];
  await paginate(
    async (p) => {
      lsCalls.push(p);
      return p.pageToken
        ? { instances: [] }
        : { instances: [], nextPageToken: "page-2" };
    },
    "instances",
    "nextPageToken",
    "pageToken",
  );
  assert.deepEqual(lsCalls, [{}, { pageToken: "page-2" }]);
});
test("pagination rejects repeated tokens rather than looping forever", async () => {
  await assert.rejects(
    paginate(async () => ({ items: [], NextToken: "again" }), "items"),
    /重复/,
  );
});
test("cross-region request concurrency is bounded and ordered", async () => {
  let running = 0,
    max = 0;
  const rows = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => {
    running++;
    max = Math.max(max, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return x * 2;
  });
  assert.equal(max, 2);
  assert.deepEqual(rows, [2, 4, 6, 8, 10, 12]);
});
test("Lightsail rotation restores the previous binding if new attachment fails", async (t) => {
  const { store } = fixture(t);
  const a = store.saveAccount(
    { name: "test", region: "us-east-1" },
    { authType: "default" },
  );
  const g = new AwsGateway(store),
    calls = [];
  g.send = async (_a, _s, _r, c, p) => {
    calls.push({ c, p });
    if (c === "GetStaticIps")
      return { staticIps: [{ name: "external-old", attachedTo: "server" }] };
    if (c === "AttachStaticIp" && p.staticIpName !== "external-old")
      throw Error("attachment failed");
    return {};
  };
  await assert.rejects(
    g.rotateIp(store.account(a.id), "lightsail", "us-east-1", "server"),
    /attachment failed/,
  );
  const attachments = calls.filter((x) => x.c === "AttachStaticIp");
  assert.equal(attachments[1].p.staticIpName, "external-old");
  assert.ok(
    !calls.some(
      (x) => x.c === "ReleaseStaticIp" && x.p.staticIpName === "external-old",
    ),
  );
});
test("Lightsail operation polling uses GetOperation(operationId)", async (t) => {
  const { store } = fixture(t);
  const g = new AwsGateway(store);
  g.send = async (_a, s, r, c, p) => {
    assert.equal(c, "GetOperation");
    assert.deepEqual(p, { operationId: "op-1" });
    return { operation: { id: "op-1", status: "Succeeded" } };
  };
  assert.equal(await g.waitLightsail({}, "us-east-1", [{ id: "op-1" }]), true);
});
test("only Lightsail and identity clients remain; other services are rejected", async (t) => {
  const { store } = fixture(t),
    g = new AwsGateway(store);
  assert.deepEqual(Object.keys(modules).sort(), ["lightsail", "sts"]);
  assert.throws(() =>
    V.target.parse({
      accountId: "account",
      region: "us-east-1",
      service: "ec2",
      id: "i-old",
    }),
  );
  await assert.rejects(
    g.perform({
      accountId: "account",
      region: "us-east-1",
      service: "ec2",
      id: "i-old",
      action: "start",
    }),
    /仅支持 Lightsail/,
  );
});

test("Lightsail creation validates platform and availability zone before AWS submission", async (t) => {
  const { store } = fixture(t),
    account = store.saveAccount(
      { name: "test", region: "us-east-1" },
      { authType: "default" },
    ),
    g = new AwsGateway(store),
    calls = [];
  g.catalog = async () => ({
    images: [{ id: "linux", platform: "LINUX_UNIX" }],
    types: [
      { id: "linux-bundle", platforms: ["LINUX_UNIX"] },
      { id: "windows-bundle", platforms: ["WINDOWS"] },
    ],
    zones: ["us-east-1a"],
  });
  g.send = async (_a, s, r, c, p) => {
    calls.push({ s, r, c, p });
    return {};
  };
  const base = {
    accountId: account.id,
    service: "lightsail",
    region: "us-east-1",
    imageId: "linux",
    instanceType: "linux-bundle",
    name: "my-server",
    count: 2,
    zone: "us-east-1a",
    userData: "#!/bin/bash",
  };
  await assert.rejects(
    g.launch({ ...base, instanceType: "windows-bundle" }),
    /平台不匹配/,
  );
  await assert.rejects(g.launch({ ...base, zone: "us-east-1b" }), /可用区/);
  assert.equal(calls.length, 0);
  await g.launch(base);
  assert.equal(calls[0].c, "CreateInstances");
  assert.equal(calls[0].s, "lightsail");
  assert.deepEqual(calls[0].p.instanceNames, ["my-server-1", "my-server-2"]);
  assert.equal(calls[0].p.availabilityZone, "us-east-1a");
});

test("attached static IPs cannot be released or silently replaced on an occupied target", async (t) => {
  const { store } = fixture(t),
    account = store.saveAccount(
      { name: "test", region: "us-east-1" },
      { authType: "default" },
    ),
    g = new AwsGateway(store),
    calls = [];
  g.send = async (_a, _s, _r, c) => {
    calls.push(c);
    if (c === "GetStaticIp")
      return {
        staticIp: {
          name: "test-ip",
          isAttached: true,
          attachedTo: "my-server",
        },
      };
    return {};
  };
  await assert.rejects(
    g.staticIpOperation({
      accountId: account.id,
      region: "us-east-1",
      action: "release",
      name: "test-ip",
    }),
    /先解绑/,
  );
  assert.ok(!calls.includes("ReleaseStaticIp"));
  g.send = async (_a, _s, _r, c) => {
    calls.push(c);
    if (c === "GetStaticIp")
      return { staticIp: { name: "test-ip", isAttached: false } };
    if (c === "GetStaticIps")
      return { staticIps: [{ name: "old-ip", attachedTo: "my-server" }] };
    return {};
  };
  await assert.rejects(
    g.staticIpOperation({
      accountId: account.id,
      region: "us-east-1",
      action: "attach",
      name: "test-ip",
      instanceName: "my-server",
    }),
    /已有静态 IP/,
  );
  assert.ok(!calls.includes("AttachStaticIp"));
});

test("Lightsail port rules preserve IPv6 input and poll the singular operation result", async (t) => {
  const { store } = fixture(t),
    account = store.saveAccount(
      { name: "test", region: "us-east-1" },
      { authType: "default" },
    ),
    g = new AwsGateway(store),
    calls = [];
  g.send = async (_a, s, _r, c, p) => {
    assert.equal(s, "lightsail");
    calls.push({ c, p });
    if (c === "OpenInstancePublicPorts") return { operation: { id: "op" } };
    if (c === "GetOperation") return { operation: { status: "Completed" } };
    return {};
  };
  const input = V.publicPorts.parse({
    accountId: account.id,
    region: "us-east-1",
    service: "lightsail",
    id: "my-server",
    portInfo: {
      protocol: "tcp",
      fromPort: 8080,
      toPort: 8080,
      ipv6Cidrs: ["2001:db8::/64"],
    },
  });
  await g.updatePorts(input);
  assert.deepEqual(calls[0].p.portInfo.ipv6Cidrs, ["2001:db8::/64"]);
  assert.equal(calls[0].p.instanceName, "my-server");
  assert.deepEqual(calls[1].p, { operationId: "op" });
  assert.throws(
    () =>
      V.publicPorts.parse({
        ...input,
        portInfo: { ...input.portInfo, ipv6Cidrs: ["192.0.2.1/32"] },
      }),
    /CIDR/,
  );
  assert.throws(
    () =>
      V.publicPorts.parse({
        ...input,
        portInfo: {
          protocol: "tcp",
          fromPort: 80,
          toPort: 20,
          cidrs: ["0.0.0.0/0"],
        },
      }),
    /端口范围/,
  );
});
test("new accounts require access keys and always use direct API connections", () => {
  assert.throws(() =>
    V.account.parse({ name: "a", authType: "keys", region: "us-east-1" }),
  );
  assert.throws(() =>
    V.account.parse({
      name: "a",
      authType: "default",
    }),
  );
  const parsed = V.account.parse({
    name: "a",
    authType: "keys",
    region: "us-east-1",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "example-secret",
    proxy: "socks5h://localhost:1080",
  });
  assert.equal(parsed.authType, "keys");
  assert.equal("proxy" in parsed, false);
});

test("HTML is never cached and missing versioned scripts are not replaced by HTML", async (t) => {
  const { store, dir } = fixture(t);
  const dist = join(dir, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    "<!doctype html><title>Panel</title>",
  );
  writeFileSync(
    join(dist, "assets", "index-current.js"),
    "console.log('current')",
  );
  const server = createApp(store, {}, { dist }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = "http://127.0.0.1:" + server.address().port;
  for (const path of ["/", "/index.html", "/ec2?demo=1"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const current = await fetch(origin + "/assets/index-current.js");
  assert.equal(current.status, 200);
  assert.match(current.headers.get("cache-control"), /immutable/);
  assert.match(current.headers.get("content-type"), /javascript/);
  const stale = await fetch(origin + "/assets/index-outdated.js");
  assert.equal(stale.status, 404);
  assert.equal(stale.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(stale.headers.get("content-type"), /html/);
});
test("API authentication, CSRF, origins, encrypted credential output, and removed scheduler routes", async (t) => {
  const { store } = fixture(t);
  const gateway = {
    identity: async (_credentials, endpointRegion) => {
      assert.equal(endpointRegion, "us-east-1");
      return {
        awsAccountId: "123456789012",
        arn: "arn:aws:iam::123456789012:user/test",
      };
    },
    invalidate: () => {},
  };
  const app = createApp(store, gateway, { dist: join(root, "no-dist") });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = "http://127.0.0.1:" + server.address().port;
  let cookie = "",
    csrf = "";
  async function request(path, body, method = "GET", extra = {}) {
    return fetch(origin + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
        Origin: origin,
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  assert.equal((await request("/accounts")).status, 401);
  assert.equal(
    (await request("/setup", { password: "short" }, "POST")).status,
    400,
  );
  const setup = await request(
    "/setup",
    { password: "test-password-long" },
    "POST",
  );
  assert.equal(setup.status, 200);
  cookie = setup.headers.get("set-cookie").split(";")[0];
  assert.match(setup.headers.get("set-cookie"), /HttpOnly/);
  assert.match(setup.headers.get("set-cookie"), /SameSite=Strict/);
  csrf = (await setup.json()).csrf;
  assert.equal(
    (await request("/setup", { password: "other-password" }, "POST")).status,
    409,
  );
  assert.equal(
    (
      await request("/accounts", { name: "bad" }, "POST", {
        "X-CSRF-Token": "wrong",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/accounts", { name: "bad" }, "POST", {
        Origin: "http://evil.invalid",
      })
    ).status,
    403,
  );
  const add = await request(
    "/accounts",
    {
      name: "test",
      accessKeyId: "dummy-id",
      secretAccessKey: "private-value",
    },
    "POST",
  );
  assert.equal(add.status, 201);
  const account = await add.json();
  assert.equal(account.region, "us-east-1");
  assert.equal(store.account(account.id).credentials.authType, "keys");
  const list = await request("/accounts");
  const text = await list.text();
  assert.ok(!text.includes("private-value"));
  assert.ok(!text.includes("dummy-id"));
  assert.ok(text.includes("keyHint"));
  for (const path of [
    "/resources/vpc",
    "/resources/cost",
    "/ssm/status",
    "/replace-root",
  ])
    assert.equal((await request(path)).status, 404);
  assert.equal((await request("/eip", {}, "POST")).status, 404);
  assert.equal(
    (
      await request(
        "/instances/action",
        {
          accountId: account.id,
          region: "us-east-1",
          service: "ec2",
          id: "i-old",
          action: "start",
        },
        "POST",
      )
    ).status,
    400,
  );
  assert.equal((await request("/tasks")).status, 404);
  assert.equal((await request("/tasks", {}, "POST")).status, 404);
  await request("/accounts/" + account.id, undefined, "DELETE");
  assert.equal((await request("/logout", {}, "POST")).status, 200);
  assert.equal((await request("/accounts")).status, 401);
});
