import { randomUUID } from "node:crypto";
import { error, paginate, scrubError } from "./shared.mjs";

export async function rotateIp(gateway, account, service, region, id) {
  if (service !== "lightsail") throw error("此面板仅支持 Lightsail");
  const { instance } = await gateway.send(
    account,
    service,
    region,
    "GetInstance",
    { instanceName: id },
  );
  if (instance?.ipAddressType === "ipv6")
    throw error("仅 IPv6 实例不能绑定或更换静态 IPv4 地址");
  const ips = await paginate(
    (p) => gateway.send(account, service, region, "GetStaticIps", p),
    "staticIps",
    "nextPageToken",
    "pageToken",
  );
  const previous = ips.find((x) => x.attachedTo === id);
  const name = `panel-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const allocated = await gateway.send(
    account,
    service,
    region,
    "AllocateStaticIp",
    { staticIpName: name },
  );
  if (!(await gateway.waitLightsail(account, region, allocated.operations)))
    return {
      staticIpName: name,
      notice:
        "新静态 IP 仍在分配，原 IP 未变动；请在 AWS Lightsail 控制台检查。",
    };
  let detached = false;
  try {
    if (previous) {
      const detachment = await gateway.send(
        account,
        service,
        region,
        "DetachStaticIp",
        { staticIpName: previous.name },
      );
      detached = true;
      if (
        !(await gateway.waitLightsail(account, region, detachment.operations))
      )
        return {
          staticIpName: name,
          notice:
            "原 IP 的解绑仍在进行，新旧 IP 均保留；请在 AWS Lightsail 控制台检查。",
        };
    }
    const attached = await gateway.send(
      account,
      service,
      region,
      "AttachStaticIp",
      { staticIpName: name, instanceName: id },
    );
    if (!(await gateway.waitLightsail(account, region, attached.operations)))
      return {
        staticIpName: name,
        notice:
          "新 IP 的关联仍在进行，旧 IP 尚未释放；请刷新或在 AWS Lightsail 控制台检查。",
      };
  } catch (e) {
    if (previous && detached) {
      try {
        await gateway.send(account, service, region, "AttachStaticIp", {
          staticIpName: previous.name,
          instanceName: id,
        });
      } catch (rollback) {
        gateway.store.audit({
          account: account.name,
          action: "rotate-ip-rollback",
          target: previous.name,
          status: "failed",
          detail: scrubError(rollback),
        });
      }
    }
    try {
      await gateway.send(account, service, region, "ReleaseStaticIp", {
        staticIpName: name,
      });
    } catch (cleanup) {
      gateway.store.audit({
        account: account.name,
        action: "rotate-ip-cleanup",
        target: name,
        status: "failed",
        detail: scrubError(cleanup),
      });
    }
    throw e;
  }
  let notice = "";
  if (previous?.name.startsWith("panel-")) {
    try {
      await gateway.send(account, service, region, "ReleaseStaticIp", {
        staticIpName: previous.name,
      });
    } catch (e) {
      notice = "旧静态 IP 释放失败，请在 AWS 控制台检查。";
    }
  } else if (previous)
    notice = `原静态 IP ${previous.name} 已保留，请核对后手动释放。`;
  return { staticIpName: name, notice };
}

export async function staticIps(gateway, accountId, region) {
  return paginate(
    (p) =>
      gateway.send(
        gateway.store.account(accountId),
        "lightsail",
        region,
        "GetStaticIps",
        p,
      ),
    "staticIps",
    "nextPageToken",
    "pageToken",
  );
}

export async function staticIpOperation(gateway, input) {
  const account = gateway.store.account(input.accountId),
    { region, name, action } = input;
  if (action !== "allocate") {
    const current = (
      await gateway.send(account, "lightsail", region, "GetStaticIp", {
        staticIpName: name,
      })
    ).staticIp;
    if (!current) throw error("静态 IP 不存在", 404);
    if (
      ["attach", "release"].includes(action) &&
      (current.isAttached || current.attachedTo)
    )
      throw error("请先解绑当前静态 IP", 409);
    if (action === "attach") {
      const { instance } = await gateway.send(
        account,
        "lightsail",
        region,
        "GetInstance",
        { instanceName: input.instanceName },
      );
      if (instance?.ipAddressType === "ipv6")
        throw error("仅 IPv6 实例不能绑定静态 IPv4 地址");
      const occupied = (await gateway.staticIps(input.accountId, region)).find(
        (x) => x.attachedTo === input.instanceName,
      );
      if (occupied) throw error("目标实例已有静态 IP，请先解绑原地址", 409);
    }
  }
  const command = {
    allocate: "AllocateStaticIp",
    attach: "AttachStaticIp",
    detach: "DetachStaticIp",
    release: "ReleaseStaticIp",
  }[action];
  const result = await gateway.send(account, "lightsail", region, command, {
    staticIpName: name,
    ...(action === "attach" ? { instanceName: input.instanceName } : {}),
  });
  return {
    operations:
      result.operations || (result.operation ? [result.operation] : []),
    notice: "静态 IP 操作已提交，正在跟踪资源状态",
  };
}

export async function ports(gateway, t) {
  const result = await gateway.send(
    gateway.store.account(t.accountId),
    "lightsail",
    t.region,
    "GetInstancePortStates",
    { instanceName: t.id },
  );
  return {
    items: (result.portStates || []).filter((x) => x.state === "open"),
  };
}

export async function updatePorts(gateway, input) {
  const account = gateway.store.account(input.accountId);
  const result = await gateway.send(
    account,
    "lightsail",
    input.region,
    input.close ? "CloseInstancePublicPorts" : "OpenInstancePublicPorts",
    { instanceName: input.id, portInfo: input.portInfo },
  );
  return {
    operations:
      result.operations || (result.operation ? [result.operation] : []),
    notice: "端口规则已提交，正在跟踪更新结果",
  };
}
