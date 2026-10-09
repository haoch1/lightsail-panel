import { error, mapLimit, paginate, scrubError } from "./shared.mjs";

export async function instances(gateway, account, service, region) {
  if (service !== "lightsail") throw error("此面板仅支持 Lightsail");
  const items = await paginate(
    (p) => gateway.send(account, service, region, "GetInstances", p),
    "instances",
    "nextPageToken",
    "pageToken",
  );
  return items.map((x) => ({
    id: x.name,
    name: x.name,
    service,
    accountId: account.id,
    accountName: account.name,
    region,
    state: x.state?.name,
    instanceType: x.bundleId,
    platform: x.blueprintName,
    publicIp: x.publicIpAddress,
    privateIp: x.privateIpAddress,
    ipv6: x.ipv6Addresses || [],
    cpu: x.hardware?.cpuCount,
    memory: x.hardware?.ramSizeInGb,
    createdAt: x.createdAt,
    zone: x.location?.availabilityZone,
    staticIp: x.isStaticIp,
    sshUser: x.username,
    imageId: x.blueprintId,
    keyName: x.sshKeyName,
    ipAddressType: x.ipAddressType,
  }));
}

export async function scan(gateway, accountIds, service, region) {
  if (service !== "lightsail") throw error("此面板仅支持 Lightsail");
  const accounts = accountIds.map((id) => gateway.store.account(id));
  const work = [];
  const errors = [];
  for (const account of accounts) {
    try {
      const regions =
        region === "all"
          ? await gateway.regions(account, service)
          : [{ id: region }];
      work.push(...regions.map((r) => ({ account, region: r.id })));
    } catch (e) {
      errors.push({
        account: account.name,
        region: account.region,
        message: scrubError(e),
      });
    }
  }
  const rows = await mapLimit(work, 4, async ({ account, region }) => {
    try {
      return await gateway.instances(account, service, region);
    } catch (e) {
      errors.push({ account: account.name, region, message: scrubError(e) });
      return [];
    }
  });
  return {
    items: rows.flat(),
    errors,
    scanned: work.length,
    at: new Date().toISOString(),
  };
}

export async function perform(gateway, input) {
  const { accountId, service, region, id, action } = input;
  if (service !== "lightsail") throw error("此面板仅支持 Lightsail");
  const account = gateway.store.account(accountId),
    lock = accountId + ":" + region + ":" + id;
  if (gateway.locks.has(lock))
    throw error("此资源有操作正在进行，请稍后重试", 409);
  gateway.locks.add(lock);
  try {
    if (action === "rotate-ip")
      return await gateway.rotateIp(account, service, region, id);
    if (["enable-ipv6", "disable-ipv6"].includes(action)) {
      const { instance } = await gateway.send(
        account,
        service,
        region,
        "GetInstance",
        { instanceName: id },
      );
      if (!instance) throw error("实例不存在", 404);
      if (
        action === "enable-ipv6" &&
        ["ipv6", "dualstack"].includes(instance.ipAddressType)
      )
        return { notice: "该实例已启用 IPv6。" };
      if (action === "disable-ipv6" && instance.ipAddressType === "ipv4")
        return { notice: "该实例已关闭 IPv6。" };
      const changesBundle =
        instance.ipAddressType === "ipv6" && action === "disable-ipv6";
      if (changesBundle && !input.acceptBundleUpdate)
        throw error(
          "关闭仅 IPv6 实例的 IPv6 需要切换为含 IPv4 套餐，请确认套餐和费用会变更",
          409,
        );
      const result = await gateway.send(
        account,
        service,
        region,
        "SetIpAddressType",
        {
          resourceType: "Instance",
          resourceName: id,
          ipAddressType: action === "enable-ipv6" ? "dualstack" : "ipv4",
          acceptBundleUpdate: changesBundle,
        },
      );
      return {
        operations:
          result.operations || (result.operation ? [result.operation] : []),
        notice: "IPv6 设置已提交，正在跟踪网络地址更新",
      };
    }
    const command = {
      start: "StartInstance",
      stop: "StopInstance",
      reboot: "RebootInstance",
      terminate: "DeleteInstance",
    }[action];
    if (!command) throw error("不支持的 Lightsail 操作");
    return await gateway.send(account, service, region, command, {
      instanceName: id,
    });
  } finally {
    gateway.locks.delete(lock);
  }
}

export async function launch(gateway, input) {
  if (input.service !== "lightsail") throw error("此面板仅支持 Lightsail");
  if (input.allocateStaticIp && input.ipAddressType === "ipv6")
    throw error("仅 IPv6 实例不能分配静态 IPv4");
  if (input.keyName && input.keyName !== "LightsailDefaultKeyPair")
    throw error("仅支持默认 SSH 密钥");
  const account = gateway.store.account(input.accountId),
    catalog = await gateway.catalog(input.accountId, "lightsail", input.region);
  const image = catalog.images.find((x) => x.id === input.imageId),
    bundle = catalog.types.find((x) => x.id === input.instanceType);
  if (!image || !bundle) throw error("镜像或套餐已不可用，请刷新目录后重试");
  if (bundle.platforms?.length && !bundle.platforms.includes(image.platform))
    throw error("套餐与镜像平台不匹配");
  if (image.minPower && bundle.power && bundle.power < image.minPower)
    throw error("该镜像需要更高规格的套餐");
  if (bundle.ipv4 === false && input.ipAddressType !== "ipv6")
    throw error("仅 IPv6 套餐必须使用 IPv6 地址类型");
  if (bundle.ipv4 !== false && input.ipAddressType === "ipv6")
    throw error("请选择仅 IPv6 套餐，或改用含 IPv4 的地址类型");
  const zone = input.zone || catalog.zones[0];
  if (!catalog.zones.length)
    throw error("此区域暂未返回可用区，请刷新创建目录或换一个区域");
  if (!catalog.zones.includes(zone))
    throw error("该区域没有所选的 Lightsail 可用区");
  return gateway.send(account, "lightsail", input.region, "CreateInstances", {
    instanceNames: Array.from({ length: input.count }, (_, i) =>
      input.count === 1 ? input.name : input.name + "-" + (i + 1),
    ),
    availabilityZone: zone,
    blueprintId: input.imageId,
    bundleId: input.instanceType,
    ipAddressType: input.ipAddressType || "dualstack",
    ...(input.userData
      ? {
          userData: /^(?:#!|#cloud-config|#cloud-boothook|#include)/.test(
            input.userData.trimStart(),
          )
            ? input.userData
            : "#!/bin/bash\n" + input.userData,
        }
      : {}),
  });
}

export async function waitLightsail(gateway, account, region, operations = []) {
  const ids = operations.map((o) => o.id).filter(Boolean);
  if (!ids.length) return true;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const ops = await Promise.all(
      ids.map((operationId) =>
        gateway
          .send(account, "lightsail", region, "GetOperation", {
            operationId,
          })
          .then((r) => r.operation),
      ),
    );
    if (ops.some((o) => ["Failed"].includes(o?.status)))
      throw error(
        ops.find((o) => o?.status === "Failed")?.errorDetails ||
          "Lightsail 操作失败",
      );
    if (
      ops.length === ids.length &&
      ops.every((o) => ["Succeeded", "Completed"].includes(o?.status))
    )
      return true;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return false;
}
