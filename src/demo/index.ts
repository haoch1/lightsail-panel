import { aggregateTraffic, trafficRange } from "../../shared/traffic.mjs";
import type {
  Account,
  AuditEntry,
  Instance,
  LaunchNetworkJob,
  PortInfo,
  StaticIp,
  TrafficLimitRule,
} from "../../shared/types";
import { demoCatalog, demoRegions as regions } from "./catalog";
const accounts: Account[] = [
  {
    id: "demo-main",
    name: "主账户",
    region: "ap-northeast-1",
    awsAccountId: "123456789012",
    authType: "keys",
    keyHint: "…DEMO",
  },
  {
    id: "demo-dev",
    name: "开发环境",
    region: "ap-southeast-1",
    awsAccountId: "234567890123",
    authType: "keys",
    keyHint: "…DEMO",
  },
];
let instances: Instance[] = [
  {
    id: "tokyo-blog",
    name: "tokyo-blog",
    service: "lightsail",
    accountId: "demo-main",
    accountName: "主账户",
    region: "ap-northeast-1",
    state: "running",
    instanceType: "small_3_0",
    platform: "Ubuntu 24.04 LTS",
    imageId: "ubuntu_24_04",
    publicIp: "198.51.100.18",
    privateIp: "172.26.8.12",
    cpu: 2,
    memory: 2,
    zone: "ap-northeast-1a",
    sshUser: "ubuntu",
    staticIp: true,
    ipAddressType: "dualstack",
    ipv6: ["2001:db8::18"],
    createdAt: "2026-09-20T04:00:00Z",
  },
  {
    id: "tokyo-api",
    name: "tokyo-api",
    service: "lightsail",
    accountId: "demo-main",
    accountName: "主账户",
    region: "ap-northeast-1",
    state: "running",
    instanceType: "micro_3_0",
    platform: "Amazon Linux 2023",
    imageId: "amazon_linux_2023",
    publicIp: "198.51.100.25",
    privateIp: "172.26.8.25",
    cpu: 2,
    memory: 1,
    zone: "ap-northeast-1c",
    sshUser: "ec2-user",
    staticIp: false,
    ipAddressType: "ipv4",
  },
  {
    id: "dev-app",
    name: "dev-app",
    service: "lightsail",
    accountId: "demo-dev",
    accountName: "开发环境",
    region: "ap-southeast-1",
    state: "stopped",
    instanceType: "small_3_0",
    platform: "Ubuntu 24.04 LTS",
    imageId: "ubuntu_24_04",
    privateIp: "172.26.4.12",
    cpu: 2,
    memory: 2,
    zone: "ap-southeast-1a",
    sshUser: "ubuntu",
    staticIp: false,
  },
];
const instanceKey = (i: Instance) => [i.accountId, i.region, i.id].join(":");
const networkJobs: LaunchNetworkJob[] = [];
let addresses: (StaticIp & { accountId: string; region: string })[] = [
  {
    name: "panel-tokyo",
    ipAddress: "198.51.100.18",
    isAttached: true,
    attachedTo: "tokyo-blog",
    accountId: "demo-main",
    region: "ap-northeast-1",
  },
  {
    name: "external-spare",
    ipAddress: "198.51.100.80",
    isAttached: false,
    accountId: "demo-main",
    region: "ap-northeast-1",
  },
];
const logs: AuditEntry[] = [
  {
    id: "demo-log",
    at: new Date().toISOString(),
    account: "主账户",
    action: "refresh",
    target: "Lightsail",
    status: "success",
    detail: "演示操作记录",
  },
];
const rules = new Map<string, PortInfo[]>();
const trafficLimits = new Map<string, TrafficLimitRule>();
let nextIp = 90;
function audit(action: string, target: string) {
  logs.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    account: "演示账户",
    action,
    target,
    status: "success",
    detail: "演示模式 · 未调用 AWS",
  });
}
export async function demoApi(
  path: string,
  body?: any,
  method?: string,
): Promise<any> {
  await new Promise((r) => setTimeout(r, 120));
  const [p, search] = path.split("?"),
    q = new URLSearchParams(search);
  const matches = (
    i: { accountId: string; region: string },
    a = q.get("accountId"),
    r = q.get("region"),
  ) =>
    (!a || a === "all" || i.accountId === a) &&
    (!r || r === "all" || i.region === r);
  if (p === "/accounts") {
    if (body) {
      const a: Account = {
        id: crypto.randomUUID(),
        name: body.name,
        region: body.region || "us-east-1",
        awsAccountId: "000000000000",
        authType: "keys",
        keyHint: "…DEMO",
      };
      accounts.push(a);
      return a;
    }
    return { items: accounts };
  }
  if (p.startsWith("/accounts/")) {
    if (p.endsWith("/verify")) return { ok: true };
    if (method === "DELETE") {
      const id = p.split("/")[2],
        index = accounts.findIndex((a) => a.id === id);
      if (index >= 0) accounts.splice(index, 1);
      instances = instances.filter((i) => i.accountId !== id);
      addresses = addresses.filter((i) => i.accountId !== id);
      return { ok: true };
    }
  }
  if (p === "/regions") return { items: regions };
  if (p === "/instances")
    return {
      items: instances.filter((i) => matches(i)),
      errors: [],
      scanned: q.get("region") === "all" ? regions.length : 1,
      at: new Date().toISOString(),
    };
  if (p === "/instances/action") {
    const i = instances.find(
      (i) => i.id === body.id && matches(i, body.accountId, body.region),
    );
    if (!i) throw Error("实例不存在");
    if (body.action === "terminate") {
      instances = instances.filter((x) => x !== i);
      addresses
        .filter(
          (x) => x.attachedTo === i.name && matches(x, i.accountId, i.region),
        )
        .forEach((x) => {
          x.isAttached = false;
          x.attachedTo = undefined;
        });
    } else if (body.action === "rotate-ip") {
      const old = addresses.find(
        (x) => x.attachedTo === i.name && matches(x, i.accountId, i.region),
      );
      if (old) {
        old.isAttached = false;
        old.attachedTo = undefined;
        if (old.name.startsWith("panel-"))
          addresses = addresses.filter((x) => x !== old);
      }
      const ip = {
        name: "panel-demo-" + crypto.randomUUID().slice(0, 8),
        ipAddress: "198.51.100." + nextIp++,
        accountId: i.accountId,
        region: i.region,
        isAttached: true,
        attachedTo: i.name,
      };
      addresses.push(ip);
      i.publicIp = ip.ipAddress;
      i.staticIp = true;
    } else if (["enable-ipv6", "disable-ipv6"].includes(body.action)) {
      if (
        body.action === "disable-ipv6" &&
        i.ipAddressType === "ipv6" &&
        !body.acceptBundleUpdate
      )
        throw Error("请确认切换含 IPv4 的套餐和费用变更");
      if (body.action === "disable-ipv6" && i.ipAddressType === "ipv6") {
        i.publicIp = "198.51.100." + nextIp++;
        i.instanceType = i.instanceType?.replace("_ipv6_", "_");
      }
      i.ipAddressType = body.action === "enable-ipv6" ? "dualstack" : "ipv4";
      i.ipv6 = body.action === "enable-ipv6" ? ["2001:db8::" + nextIp++] : [];
    } else i.state = body.action === "stop" ? "stopped" : "running";
    audit(body.action, i.name);
    return { notice: "演示状态已更新" };
  }
  if (p === "/catalog")
    return {
      ...demoCatalog,
      zones: regions.find((r) => r.id === q.get("region"))?.zones || [],
    };
  if (p === "/launch/network") return { items: networkJobs };
  if (p === "/launch") {
    const previous = networkJobs.find((job) => job.id === body.token);
    if (previous) return { ok: true, networkJob: previous };
    if (body.allocateStaticIp && body.ipAddressType === "ipv6")
      throw Error("仅 IPv6 实例不能分配静态 IPv4");
    const a = accounts.find((a) => a.id === body.accountId);
    const created: LaunchNetworkJob["instances"] = [];
    for (let n = 0; n < body.count; n++) {
      const name = body.count === 1 ? body.name : body.name + "-" + (n + 1);
      if (
        instances.some(
          (i) => i.name === name && matches(i, body.accountId, body.region),
        )
      )
        throw Error("实例名称已存在");
      instances.push({
        id: name,
        name,
        service: "lightsail",
        accountId: body.accountId,
        accountName: a?.name || "演示账户",
        region: body.region,
        state: "running",
        instanceType: body.instanceType,
        platform:
          demoCatalog.images.find((i) => i.id === body.imageId)?.name ||
          body.imageId,
        imageId: body.imageId,
        zone: body.zone,
        keyName: "LightsailDefaultKeyPair",
        publicIp:
          body.ipAddressType === "ipv6" ? undefined : "198.51.100." + nextIp++,
        ipv6: body.ipAddressType === "ipv4" ? [] : ["2001:db8::" + nextIp++],
        ipAddressType: body.ipAddressType,
        privateIp: "172.26.1.10",
        cpu: demoCatalog.types.find((b) => b.id === body.instanceType)?.cpu,
        memory: demoCatalog.types.find((b) => b.id === body.instanceType)
          ?.memory,
        staticIp: !!body.allocateStaticIp,
        createdAt: new Date().toISOString(),
      });
      const instance = instances[instances.length - 1];
      if (body.firewall)
        rules.set(
          instanceKey(instance),
          body.firewall.map((rule: PortInfo) => ({ ...rule })),
        );
      const staticIpName = body.allocateStaticIp
        ? `panel-${body.token}-${n + 1}`
        : undefined;
      if (staticIpName)
        addresses.push({
          name: staticIpName,
          ipAddress: instance.publicIp!,
          isAttached: true,
          attachedTo: name,
          accountId: body.accountId,
          region: body.region,
        });
      created.push({ name, stage: "done", staticIpName });
    }
    audit("launch", body.name);
    const networkJob: LaunchNetworkJob | undefined =
      body.firewall || body.allocateStaticIp
        ? {
            id: body.token,
            accountId: body.accountId,
            region: body.region,
            status: "success",
            instances: created,
          }
        : undefined;
    if (networkJob) networkJobs.push(networkJob);
    return { ok: true, networkJob, notice: "演示实例已创建" };
  }
  if (p === "/traffic-limit") {
    const key = [
      body?.accountId || q.get("accountId"),
      body?.region || q.get("region"),
      body?.id || q.get("id"),
    ].join(":");
    if (body) {
      const instance = instances.find((i) => instanceKey(i) === key);
      const bundle = demoCatalog.types.find(
        (b) => b.id === instance?.instanceType,
      );
      trafficLimits.set(key, {
        ...body,
        status: body.enabled ? "monitoring" : "disabled",
        allowanceBytes: (bundle?.transfer || 1024) * 1024 ** 3,
      });
    }
    return { rule: trafficLimits.get(key) || null };
  }
  if (p === "/traffic") {
    const now = new Date(),
      window = trafficRange(
        q.get("range") || "month",
        now,
        Number(q.get("utcOffsetMinutes") || 0),
      ),
      count = (window.end.getTime() - window.start.getTime()) / 3600000;
    const factor =
      q.get("id") === "tokyo-api" ? 0.45 : q.get("id") === "dev-app" ? 0 : 1;
    const values = [0, 1].map((direction) =>
      Array.from({ length: count }, (_, n) => ({
        timestamp: new Date(window.start.getTime() + n * 3600000),
        sum: Math.round(
          (direction ? 75000000 : 28000000) *
            (1 + 0.4 * Math.sin(n / 8)) *
            factor,
        ),
      })),
    );
    return {
      ...aggregateTraffic(values, window),
      warnings: [],
      at: now.toISOString(),
    };
  }
  if (p === "/static-ips") {
    if (!body) return { items: addresses.filter((ip) => matches(ip)) };
    const { accountId, region, name, action, instanceName } = body,
      ip = addresses.find(
        (x) => x.name === name && matches(x, accountId, region),
      );
    if (action === "allocate") {
      if (ip) throw Error("名称已存在");
      addresses.push({
        name,
        ipAddress: "198.51.100." + nextIp++,
        isAttached: false,
        accountId,
        region,
      });
    } else {
      if (!ip) throw Error("静态 IP 不存在");
      if (action === "release") {
        if (ip.isAttached) throw Error("请先解绑当前静态 IP");
        addresses = addresses.filter((x) => x !== ip);
      }
      if (action === "detach") {
        const i = instances.find(
          (i) => i.id === ip.attachedTo && matches(i, accountId, region),
        );
        if (i) {
          i.staticIp = false;
          i.publicIp = "198.51.100." + nextIp++;
        }
        ip.isAttached = false;
        ip.attachedTo = undefined;
      }
      if (action === "attach") {
        const i = instances.find(
          (i) => i.id === instanceName && matches(i, accountId, region),
        );
        if (!i) throw Error("目标实例不存在");
        if (ip.isAttached || i.staticIp) throw Error("请先解绑已有静态 IP");
        ip.isAttached = true;
        ip.attachedTo = i.name;
        i.staticIp = true;
        i.publicIp = ip.ipAddress;
      }
    }
    audit("static-ip-" + action, name);
    return { notice: "演示静态 IP 状态已更新" };
  }
  if (p === "/ports") {
    const key = (
      body
        ? [body.accountId, body.region, body.id]
        : [q.get("accountId"), q.get("region"), q.get("id")]
    ).join(":");
    if (!rules.has(key)) {
      const i = instances.find((i) => instanceKey(i) === key);
      const source =
        i?.ipAddressType === "ipv6"
          ? { ipv6Cidrs: ["::/0"] }
          : { cidrs: ["0.0.0.0/0"] };
      rules.set(
        key,
        [22, 80].map((port) => ({
          protocol: "tcp",
          fromPort: port,
          toPort: port,
          ...source,
        })),
      );
    }
    if (!body) return { items: rules.get(key) };
    const r = body.portInfo;
    if (body.close)
      rules.set(
        key,
        rules.get(key)!.filter((x) => JSON.stringify(x) !== JSON.stringify(r)),
      );
    else rules.get(key)!.push(r);
    audit(body.close ? "close-port" : "open-port", body.id);
    return { notice: "演示端口规则已更新" };
  }
  if (p === "/audit") {
    if (method === "DELETE") {
      const deleted = logs.length;
      logs.length = 0;
      return { deleted };
    }
    return { items: [...logs] };
  }
  throw new Error("此演示仅支持 Lightsail 相关操作");
}
