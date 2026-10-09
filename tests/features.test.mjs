import assert from "node:assert/strict";
import { createPrivateKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createApp } from "../server/app.mjs";
import { AwsGateway } from "../server/aws.mjs";
import { Store } from "../server/store.mjs";
import * as V from "../server/validation.mjs";
import {
  allPublicSources,
  firewallPresets,
} from "../src/features/firewall/presets.ts";
import { defaultStartupScript } from "../src/features/launch/default-script.ts";
function fixture(t) {
  const root = resolve("../aws-panel-reference");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "feature-test-"));
  const store = new Store(dir);
  const account = store.saveAccount(
    { name: "test", region: "us-east-1" },
    {
      authType: "keys",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
    },
  );
  t.after(() => {
    store.close();
    assert.ok(dir.startsWith(root + "\\") || dir.startsWith(root + "/"));
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, account, g: new AwsGateway(store) };
}
test("catalog follows every page and keeps active Linux OS images and both network plan families", async (t) => {
  const { g, account } = fixture(t),
    calls = [];
  g.send = async (_a, _s, _r, c, p) => {
    calls.push({ c, p });
    if (c === "GetRegions")
      return {
        regions: [
          {
            name: "us-east-1",
            availabilityZones: [
              { zoneName: "us-east-1a", state: "available" },
              { zoneName: "us-east-1b", state: "unavailable" },
            ],
          },
        ],
      };
    if (c === "GetBlueprints")
      return p.pageToken
        ? {
            blueprints: [
              {
                blueprintId: "debian_13",
                type: "os",
                platform: "LINUX_UNIX",
                isActive: true,
                minPower: 2,
              },
              {
                blueprintId: "centos_stream_9",
                name: "CentOS Stream",
                version: "9",
                type: "os",
                platform: "LINUX_UNIX",
                isActive: true,
              },
              {
                blueprintId: "alma_linux_9",
                type: "os",
                platform: "LINUX_UNIX",
                isActive: true,
              },
              {
                blueprintId: "amazon_linux_2023",
                type: "os",
                platform: "LINUX_UNIX",
                isActive: true,
              },
              {
                blueprintId: "debian_11",
                type: "os",
                platform: "LINUX_UNIX",
                isActive: false,
              },
              {
                blueprintId: "wordpress",
                type: "app",
                platform: "LINUX_UNIX",
                isActive: true,
              },
              {
                blueprintId: "windows",
                type: "os",
                platform: "WINDOWS",
                isActive: true,
              },
              {
                blueprintId: "freebsd_14",
                type: "os",
                platform: "LINUX_UNIX",
                isActive: true,
              },
              { blueprintId: "old", isActive: false },
              {
                blueprintId: "research",
                type: "os",
                platform: "LINUX_UNIX",
                isActive: true,
                appCategory: "LfR",
              },
            ],
          }
        : {
            blueprints: [
              {
                blueprintId: "ubuntu",
                type: "os",
                platform: "LINUX_UNIX",
                isActive: true,
              },
            ],
            nextPageToken: "images-2",
          };
    if (c === "GetBundles")
      return p.pageToken
        ? {
            bundles: [
              {
                bundleId: "ipv6",
                isActive: true,
                supportedPlatforms: ["LINUX_UNIX"],
                publicIpv4AddressCount: 0,
                price: 3.5,
                power: 1,
                ramSizeInGb: 0.5,
                cpuCount: 2,
                diskSizeInGb: 20,
              },
              {
                bundleId: "windows",
                isActive: true,
                supportedPlatforms: ["WINDOWS"],
              },
              { bundleId: "inactive", isActive: false },
            ],
          }
        : {
            bundles: [
              {
                bundleId: "ipv4",
                isActive: true,
                supportedPlatforms: ["LINUX_UNIX"],
                publicIpv4AddressCount: 1,
                price: 5,
              },
            ],
            nextPageToken: "bundles-2",
          };
    return {};
  };
  const catalog = await g.catalog(account.id, "lightsail", "us-east-1");
  assert.deepEqual(
    catalog.images.map((i) => i.id),
    ["debian_13", "ubuntu", "centos_stream_9"],
  );
  assert.equal(catalog.images[0].minPower, 2);
  assert.deepEqual(
    catalog.types.map((b) => b.id),
    ["ipv4", "ipv6"],
  );
  assert.equal(catalog.types[1].ipv4, false);
  assert.equal(catalog.types[1].price, 3.5);
  assert.deepEqual(catalog.zones, ["us-east-1a"]);
  assert.equal(
    calls.find((x) => x.p.pageToken === "images-2").p.includeInactive,
    false,
  );
  assert.equal(
    calls.find((x) => x.p.pageToken === "bundles-2").p.includeInactive,
    false,
  );
});
test("creation validates minimum power and network family before submitting", async (t) => {
  const { g, account } = fixture(t),
    calls = [];
  g.catalog = async () => ({
    images: [
      { id: "app", platform: "LINUX_UNIX", minPower: 2 },
      { id: "windows", platform: "WINDOWS" },
    ],
    types: [
      { id: "small", power: 1, platforms: ["LINUX_UNIX"], ipv4: true },
      { id: "large6", power: 2, platforms: ["LINUX_UNIX"], ipv4: false },
      { id: "win", platforms: ["WINDOWS"], ipv4: true },
    ],
    zones: ["us-east-1a"],
  });
  g.send = async (_a, _s, _r, c, p) => {
    calls.push({ c, p });
    return {};
  };
  const base = {
    accountId: account.id,
    service: "lightsail",
    region: "us-east-1",
    imageId: "app",
    instanceType: "small",
    name: "web",
    count: 1,
    zone: "us-east-1a",
    ipAddressType: "dualstack",
  };
  await assert.rejects(g.launch(base), /更高规格/);
  await assert.rejects(g.launch({ ...base, instanceType: "large6" }), /IPv6/);
  assert.equal(calls.length, 0);
  await g.launch({
    ...base,
    instanceType: "large6",
    ipAddressType: "ipv6",
  });
  assert.equal(calls[0].p.ipAddressType, "ipv6");
  assert.throws(
    () =>
      V.launch.parse({
        ...base,
        name: "a".repeat(62),
        count: 20,
        token: randomUUID(),
      }),
    /63/,
  );
});
test("IPv6-only instances reject static IPv4 allocation and attachment before mutation", async (t) => {
  const { g, account, store } = fixture(t),
    calls = [];
  g.send = async (_a, _s, _r, c) => {
    calls.push(c);
    return c === "GetInstance"
      ? { instance: { ipAddressType: "ipv6" } }
      : { staticIp: { name: "free-ip", isAttached: false } };
  };
  await assert.rejects(
    g.rotateIp(
      store.account(account.id),
      "lightsail",
      "us-east-1",
      "ipv6-server",
    ),
    /IPv6/,
  );
  await assert.rejects(
    g.staticIpOperation({
      accountId: account.id,
      region: "us-east-1",
      action: "attach",
      name: "free-ip",
      instanceName: "ipv6-server",
    }),
    /IPv6/,
  );
  assert.ok(
    !calls.includes("AllocateStaticIp") && !calls.includes("AttachStaticIp"),
  );
});
test("IPv6 changes preserve IPv4 plans and require explicit acceptance for IPv6-only bundle conversion", async (t) => {
  const { g, account } = fixture(t),
    calls = [];
  let type = "ipv4";
  g.send = async (_a, _s, _r, c, p) => {
    calls.push({ c, p });
    return c === "GetInstance" ? { instance: { ipAddressType: type } } : {};
  };
  const base = {
    accountId: account.id,
    service: "lightsail",
    region: "us-east-1",
    id: "server",
  };
  await g.perform({ ...base, action: "enable-ipv6" });
  assert.deepEqual(calls.find((x) => x.c === "SetIpAddressType").p, {
    resourceType: "Instance",
    resourceName: "server",
    ipAddressType: "dualstack",
    acceptBundleUpdate: false,
  });
  type = "dualstack";
  await g.perform({ ...base, action: "disable-ipv6" });
  assert.equal(
    calls.filter((x) => x.c === "SetIpAddressType")[1].p.ipAddressType,
    "ipv4",
  );
  type = "ipv6";
  const before = calls.filter((x) => x.c === "SetIpAddressType").length;
  await assert.rejects(
    g.perform({ ...base, action: "disable-ipv6" }),
    /确认套餐和费用/,
  );
  assert.equal(calls.filter((x) => x.c === "SetIpAddressType").length, before);
  await g.perform({
    ...base,
    action: "disable-ipv6",
    acceptBundleUpdate: true,
  });
  assert.equal(
    calls.filter((x) => x.c === "SetIpAddressType").at(-1).p.acceptBundleUpdate,
    true,
  );
  await g.perform({ ...base, action: "enable-ipv6" });
  assert.equal(
    calls.filter((x) => x.c === "SetIpAddressType").length,
    before + 1,
  );
});
test("removed billing, snapshot and DNS APIs return 404", async (t) => {
  const { store } = fixture(t);
  const server = createApp(store, new AwsGateway(store), {
    dist: resolve("../aws-panel-reference/no-dist"),
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const session = store.createSession();
  const origin = "http://127.0.0.1:" + server.address().port;
  for (const path of [
    "/cost?accountId=x&month=2025-01",
    "/snapshots",
    "/auto-snapshots",
    "/domains",
  ]) {
    const response = await fetch(origin + "/api" + path, {
      headers: { Cookie: "panel_session=" + session.token },
    });
    assert.equal(response.status, 404, path);
  }
});
test("startup template requires replacing the password placeholder and plain scripts receive a shell header", async (t) => {
  const { g, account } = fixture(t),
    calls = [];
  const input = {
    accountId: account.id,
    region: "us-east-1",
    service: "lightsail",
    imageId: "debian_13",
    instanceType: "small",
    zone: "us-east-1a",
    name: "linux-test",
    count: 1,
    ipAddressType: "dualstack",
    token: randomUUID(),
  };
  assert.throws(
    () => V.launch.parse({ ...input, userData: defaultStartupScript }),
    /你的密码/,
  );
  const script = defaultStartupScript.replace("你的密码", "example-test-only");
  g.catalog = async () => ({
    images: [{ id: "debian_13", platform: "LINUX_UNIX" }],
    types: [{ id: "small", ipv4: true }],
    zones: ["us-east-1a"],
  });
  g.send = async (_a, _s, _r, c, p) => {
    calls.push({ c, p });
    return {};
  };
  await g.launch(V.launch.parse({ ...input, userData: script }));
  assert.equal(calls[0].c, "CreateInstances");
  assert.equal(calls[0].p.userData, "#!/bin/bash\n" + script);
  for (const userData of [
    "#!/bin/sh\necho ok",
    "#cloud-config\npackages: []",
  ]) {
    await g.launch(V.launch.parse({ ...input, userData }));
    assert.equal(calls.at(-1).p.userData, userData);
  }
});
test("firewall presets produce supported native port rules for IPv4 and IPv6", () => {
  assert.deepEqual(
    firewallPresets.map((p) => p.id),
    ["all-tcp", "all-udp", "all"],
  );
  assert.equal(allPublicSources("ipv6"), "::/0");
  assert.equal(allPublicSources("dualstack"), "0.0.0.0/0,::/0");
  assert.equal(allPublicSources("ipv4"), "0.0.0.0/0");
  assert.equal(allPublicSources(undefined), "0.0.0.0/0");
  const target = {
    accountId: "account",
    region: "us-east-1",
    service: "lightsail",
    id: "instance",
  };
  for (const preset of firewallPresets) {
    for (const family of [4, 6]) {
      const portInfo = {
        protocol:
          preset.protocol === "icmp" && family === 6
            ? "icmpv6"
            : preset.protocol,
        fromPort: preset.from,
        toPort: preset.to,
        ...(family === 4
          ? { cidrs: ["198.51.100.4/32"] }
          : { ipv6Cidrs: ["2001:db8::/64"] }),
      };
      assert.doesNotThrow(
        () => V.publicPorts.parse({ ...target, portInfo }),
        preset.id,
      );
      assert.throws(
        () =>
          V.publicPorts.parse({
            ...target,
            portInfo: { ...portInfo, cidrs: ["not-an-ip"] },
          }),
        /CIDR/,
      );
    }
  }
});
test("default SSH keys use the selected region, decode AWS base64 PEM and reject absent or invalid keys", async (t) => {
  const { g, account, store } = fixture(t),
    calls = [];
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  g.send = async (a, service, region, command, input) => {
    calls.push({ id: a.id, service, region, command, input });
    return { privateKeyBase64: Buffer.from(privateKey).toString("base64") };
  };
  const result = await g.downloadDefaultKeyPair(account.id, "ap-northeast-1");
  assert.deepEqual(calls, [
    {
      id: account.id,
      service: "lightsail",
      region: "ap-northeast-1",
      command: "DownloadDefaultKeyPair",
      input: {},
    },
  ]);
  assert.equal(result.filename, "LightsailDefaultKey-ap-northeast-1.pem");
  assert.equal(result.privateKey, privateKey);
  assert.equal(createPrivateKey(result.privateKey).asymmetricKeyType, "rsa");
  assert.ok(!JSON.stringify(store.accounts()).includes(privateKey));
  g.send = async () => ({});
  await assert.rejects(
    g.downloadDefaultKeyPair(account.id, "us-east-1"),
    /未返回/,
  );
  g.send = async () => ({
    privateKeyBase64: Buffer.from("not-a-key").toString("base64"),
  });
  await assert.rejects(
    g.downloadDefaultKeyPair(account.id, "us-east-1"),
    /格式无效/,
  );
});
test("SSH private-key download requires a session and CSRF, bypasses cache, validates region and keeps key out of audit", async (t) => {
  const { store, account } = fixture(t),
    calls = [];
  const gateway = {
    downloadDefaultKeyPair: async (id, region) => {
      calls.push({ id, region });
      return {
        filename: `LightsailDefaultKey-${region}.pem`,
        privateKey: "test-only-key-content",
      };
    },
  };
  const server = createApp(store, gateway, {
    dist: resolve("../aws-panel-reference/no-dist"),
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = "http://127.0.0.1:" + server.address().port,
    session = store.createSession();
  const body = { accountId: account.id, region: "us-east-1" };
  function request(value = body, authenticated = true, csrf = session.csrf) {
    return fetch(origin + "/api/ssh/default-key", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(authenticated
          ? { Cookie: "panel_session=" + session.token, "X-CSRF-Token": csrf }
          : {}),
      },
      body: JSON.stringify(value),
    });
  }
  assert.equal((await request(body, false)).status, 401);
  assert.equal((await request(body, true, "bad-token")).status, 403);
  assert.equal((await request({ ...body, region: "bad/region" })).status, 400);
  assert.equal(calls.length, 0);
  for (let i = 0; i < 2; i++) {
    const response = await request();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal((await response.json()).privateKey, "test-only-key-content");
  }
  assert.equal(calls.length, 2);
  assert.equal(
    store.logs().filter((log) => log.action === "download-default-key").length,
    2,
  );
  assert.ok(!JSON.stringify(store.logs()).includes("test-only-key-content"));
});
