import { createHash, randomUUID } from "node:crypto";
import { error, mapLimit, scrubError } from "./aws/shared.mjs";
import { portRuleCovered, portRulePresent } from "../shared/firewall.ts";
import {
  operationAuditAction,
  operationAuditDetail,
} from "./audit-details.mjs";

export const launchFingerprint = (input) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
const operationsOf = (result) =>
  result?.operations || (result?.operation ? [result.operation] : []);
const missing = (e) => e.name === "NotFoundException";
const transient = (e) =>
  [
    "ThrottlingException",
    "ServiceException",
    "OperationInProgressException",
  ].includes(e.name) ||
  (e.name === "OperationFailureException" &&
    /another request is in progress/i.test(e.message)) ||
  e.$metadata?.httpStatusCode >= 500;

// Persist only network configuration and progress, never userData or credentials.
export class LaunchNetworkQueue {
  constructor(store, gateway, invalidate = () => {}) {
    this.store = store;
    this.gateway = gateway;
    this.invalidate = invalidate;
    this.busy = false;
    this.stopped = false;
    this.locks = new Set();
    this.stop = () => {
      this.stopped = true;
      clearInterval(this.timer);
    };
    store.onClose.add(this.stop);
  }
  start() {
    const run = () => {
      void this.tick().catch((e) => {
        if (!this.stopped)
          console.error("Launch network worker:", scrubError(e));
      });
    };
    this.timer = setInterval(run, 5000);
    this.timer.unref();
    run();
  }
  save(job) {
    if (this.stopped) return;
    const previous = this.store.launchNetwork(job.id);
    if (previous && previous.status !== "pending") return;
    this.store.saveLaunchNetwork(job);
  }
  view(job) {
    return {
      id: job.id,
      accountId: job.accountId,
      region: job.region,
      action: job.action || "launch",
      resources: job.resources || ["instances", "static-ips", "ports"],
      status: job.status,
      at: job.at,
      completedAt: job.completedAt,
      targetInstance: job.targetInstance,
      instances: job.instances.map(({ name, stage, detail, staticIpName }) => ({
        name,
        stage,
        detail,
        staticIpName,
      })),
    };
  }
  recent() {
    return this.store
      .launchNetworks({ recentSince: Date.now() - 30 * 60 * 1000 })
      .map((job) => this.view(job));
  }
  enqueue(input, result, auditId) {
    const job = {
      id: input.token,
      auditId,
      action: "launch",
      resources: [
        "instances",
        ...(input.allocateStaticIp ? ["static-ips"] : []),
        ...(input.firewall ? ["ports"] : []),
      ],
      fingerprint: launchFingerprint(input),
      accountId: input.accountId,
      region: input.region,
      firewall: input.firewall,
      allocateStaticIp: input.allocateStaticIp,
      at: Date.now(),
      deadline: Date.now() + 10 * 60 * 1000,
      status: "pending",
      instances: Array.from({ length: input.count }, (_, index) => {
        const name =
          input.count === 1 ? input.name : `${input.name}-${index + 1}`;
        return {
          name,
          stage: "instance",
          operations: operationsOf(result)
            .filter((o) => !o.resourceName || o.resourceName === name)
            .map((o) => o.id)
            .filter(Boolean),
          staticIpName: input.allocateStaticIp
            ? `panel-${input.token}-${index + 1}`
            : undefined,
        };
      }),
    };
    this.save(job);
    return this.view(job);
  }
  watch(input, result = {}, resource = "instances", auditId) {
    if (result?.unchanged) return;
    const name = input.id || input.name;
    const previous = this.store
      .launchNetworks({ pendingOnly: true })
      .filter(
        (job) =>
          (job.action === "launch" || job.resource === resource) &&
          job.accountId === input.accountId &&
          job.region === input.region &&
          job.instances.some((item) => item.name === name),
      );
    if (input.passive && previous.length) return;
    // A timed-out observation stays stopped until an explicit retry or a new mutation.
    if (
      input.passive &&
      !input.retry &&
      this.store.latestInstanceJob(input.accountId, input.region, name)
        ?.status === "failed"
    )
      return;
    if (!input.passive)
      for (const job of previous.filter((job) => job.action !== "launch")) {
        job.status = "success";
        for (const item of job.instances) {
          item.stage = "done";
          item.detail = "由后续资源操作接续跟踪";
        }
        job.completedAt = Date.now();
        this.completeAudit(job);
        this.save(job);
      }
    const job = {
      id: randomUUID(),
      auditId,
      auditNotice:
        input.auditDetail ||
        (input.action === "rotate-ip" &&
          /已保留|释放失败/.test(result?.notice || ""))
          ? scrubError({ message: input.auditDetail || result.notice })
          : undefined,
      accountId: input.accountId,
      region: input.region,
      action: input.action || "observe",
      resource,
      resources:
        resource === "static-ips"
          ? [
              "static-ips",
              ...(["attach", "detach"].includes(input.action)
                ? ["instances"]
                : []),
            ]
          : resource === "ports"
            ? ["ports"]
            : [
                "instances",
                ...(input.action === "rotate-ip" ? ["static-ips"] : []),
              ],
      at: Date.now(),
      deadline: Date.now() + 10 * 60 * 1000,
      status: "pending",
      targetInstance: input.instanceName,
      expectedPort: input.portInfo,
      close: input.close,
      expectedState: input.expectedState,
      staticIpName: result?.staticIpName,
      instances: [
        {
          name,
          stage: "observe",
          operations: operationsOf(result)
            .map((o) => o.id)
            .filter(Boolean),
        },
      ],
    };
    this.save(job);
    return this.view(job);
  }
  async run(input, resource, perform, auditId) {
    const names = [input.id || input.name, input.instanceName].filter(Boolean);
    const keys = names.map(
      (name) => `${input.accountId}:${input.region}:${name}`,
    );
    const pending = this.store
      .launchNetworks({ pendingOnly: true })
      .some(
        (job) =>
          job.accountId === input.accountId &&
          job.region === input.region &&
          (job.instances.some((item) => names.includes(item.name)) ||
            names.includes(job.targetInstance)),
      );
    if (pending || keys.some((key) => this.locks.has(key)))
      throw error("该资源的上一项操作尚未完成，请等待状态更新后再提交。", 409);
    for (const key of keys) this.locks.add(key);
    try {
      const result = await perform();
      const networkJob = this.watch(input, result, resource, auditId);
      return networkJob ? { ...result, networkJob } : result;
    } finally {
      for (const key of keys) this.locks.delete(key);
    }
  }
  completeAudit(job) {
    const result = { status: job.status, detail: operationAuditDetail(job) };
    if (job.auditId) this.store.updateAudit(job.auditId, result);
    else
      this.store.audit({
        account: job.accountId,
        action: operationAuditAction(job),
        target: job.instances.map((item) => item.name).join(", "),
        ...result,
      });
  }
  async observe(job, item, send) {
    if (job.resource === "static-ips") {
      let ip;
      try {
        ip = (await send("GetStaticIp", { staticIpName: item.name })).staticIp;
      } catch (e) {
        if (!missing(e)) throw e;
      }
      if (
        job.action === "release"
          ? !ip
          : job.action === "attach"
            ? ip?.attachedTo === job.targetInstance
            : job.action === "detach"
              ? ip && !ip.attachedTo && !ip.isAttached
              : !!ip
      )
        item.stage = "done";
      return;
    }
    if (job.resource === "ports") {
      const result = await send("GetInstancePortStates", {
        instanceName: item.name,
      });
      const expected = job.expectedPort;
      if (expected) {
        const open = (result.portStates || []).filter(
          (p) => p.state === "open",
        );
        if (
          job.close
            ? portRulePresent(open, expected)
            : !portRuleCovered(open, expected)
        )
          return;
      }
      item.stage = "done";
      return;
    }
    let instance;
    try {
      instance = (await send("GetInstance", { instanceName: item.name }))
        .instance;
    } catch (e) {
      if (!missing(e)) throw e;
    }
    if (job.action === "terminate") {
      if (!instance || instance.state?.name === "terminated")
        item.stage = "done";
      return;
    }
    if (!instance) return;
    const expected =
      job.expectedState ||
      { start: "running", stop: "stopped", reboot: "running" }[job.action];
    if (expected && instance.state?.name !== expected) return;
    if (
      [
        "pending",
        "starting",
        "stopping",
        "rebooting",
        "shutting-down",
      ].includes(instance.state?.name)
    )
      return;
    if (
      job.action === "enable-ipv6" &&
      (!["ipv6", "dualstack"].includes(instance.ipAddressType) ||
        !instance.ipv6Addresses?.length)
    )
      return;
    if (
      job.action === "disable-ipv6" &&
      (instance.ipAddressType !== "ipv4" || instance.ipv6Addresses?.length)
    )
      return;
    if (job.action === "rotate-ip" && job.staticIpName) {
      const { staticIp } = await send("GetStaticIp", {
        staticIpName: job.staticIpName,
      });
      if (staticIp?.attachedTo !== item.name) return;
    }
    item.stage = "done";
  }
  next(job, item, result, stage) {
    item.operations = operationsOf(result)
      .map((o) => o.id)
      .filter(Boolean);
    item.stage = stage;
    this.save(job);
  }
  async step(job, item) {
    if (
      this.stopped ||
      ["done", "failed"].includes(item.stage) ||
      item.nextCheck > Date.now()
    )
      return;
    const account = this.store.account(job.accountId);
    const send = (command, input) =>
      this.gateway.send(account, "lightsail", job.region, command, input);
    try {
      if (Date.now() > job.deadline)
        throw error(
          job.action && job.action !== "launch"
            ? "状态更新超时，请核对资源或手动刷新；不会重复执行操作"
            : "网络配置超时，请在实例、防火墙和静态 IP 页面核对；无需重新创建实例",
        );
      if (item.operations?.length) {
        const operations = await mapLimit(
          item.operations,
          1,
          async (operationId) => {
            try {
              return (await send("GetOperation", { operationId })).operation;
            } catch (e) {
              if (missing(e)) return { status: "Started" };
              throw e;
            }
          },
        );
        if (this.stopped) return;
        const failed = operations.find((o) => o?.status === "Failed");
        if (failed)
          throw error(
            failed.errorDetails || failed.errorCode || "Lightsail 操作失败",
          );
        if (
          !operations.every((o) =>
            ["Succeeded", "Completed"].includes(o?.status),
          )
        )
          return;
        item.operations = [];
      }
      if (item.stage === "observe") {
        await this.observe(job, item, send);
      } else if (item.stage === "instance") {
        let instance;
        try {
          instance = (await send("GetInstance", { instanceName: item.name }))
            .instance;
        } catch (e) {
          if (missing(e)) return;
          throw e;
        }
        if (this.stopped) return;
        if (instance?.state?.name !== "running") return;
        item.stage = job.firewall
          ? "firewall"
          : job.allocateStaticIp
            ? "allocate"
            : "done";
      } else if (item.stage === "firewall") {
        const result = await send("PutInstancePublicPorts", {
          instanceName: item.name,
          portInfos: job.firewall,
        });
        this.next(
          job,
          item,
          result,
          job.allocateStaticIp ? "allocate" : "finish",
        );
      } else if (item.stage === "allocate") {
        let ip;
        try {
          ip = (await send("GetStaticIp", { staticIpName: item.staticIpName }))
            .staticIp;
        } catch (e) {
          if (!missing(e)) throw e;
        }
        if (this.stopped) return;
        if (ip?.attachedTo && ip.attachedTo !== item.name)
          throw error("静态 IP 已绑定其他实例，未修改该地址");
        if (ip) {
          item.allocated = true;
          item.stage = ip.attachedTo === item.name ? "done" : "attach";
        } else {
          const result = await send("AllocateStaticIp", {
            staticIpName: item.staticIpName,
          });
          item.allocated = true;
          this.next(job, item, result, "attach");
        }
      } else if (item.stage === "attach") {
        let ip;
        try {
          ip = (await send("GetStaticIp", { staticIpName: item.staticIpName }))
            .staticIp;
        } catch (e) {
          if (missing(e)) return;
          throw e;
        }
        if (this.stopped) return;
        if (!ip) return;
        if (ip.attachedTo === item.name) item.stage = "done";
        else {
          if (ip.attachedTo || ip.isAttached)
            throw error("静态 IP 已绑定其他实例，未修改该地址");
          // Persist before submission: ambiguous failures must not release an IP being attached.
          item.attachmentAttempted = true;
          this.save(job);
          const result = await send("AttachStaticIp", {
            staticIpName: item.staticIpName,
            instanceName: item.name,
          });
          this.next(job, item, result, "verify");
        }
      } else if (item.stage === "verify") {
        const { staticIp } = await send("GetStaticIp", {
          staticIpName: item.staticIpName,
        });
        if (staticIp?.attachedTo === item.name) item.stage = "done";
      } else if (item.stage === "finish") item.stage = "done";
      this.save(job);
    } catch (e) {
      if (this.stopped || transient(e)) return;
      item.stage = "failed";
      item.detail = scrubError(e);
      if (item.allocated && !item.attachmentAttempted) {
        try {
          const { staticIp } = await send("GetStaticIp", {
            staticIpName: item.staticIpName,
          });
          if (staticIp && !staticIp.attachedTo && !staticIp.isAttached) {
            await send("ReleaseStaticIp", { staticIpName: item.staticIpName });
            item.allocated = false;
          }
        } catch {
          /* Retain and report an address if cleanup cannot be confirmed. */
        }
      }
      if (item.allocated)
        item.detail += `；静态 IP ${item.staticIpName} 已保留，请在静态 IP 页面核对`;
      this.save(job);
    } finally {
      if (!this.stopped && !["done", "failed"].includes(item.stage)) {
        item.nextCheck =
          Date.now() + (Date.now() - job.at < 60000 ? 5000 : 15000);
        this.save(job);
      }
    }
  }
  async tick() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      const jobs = this.store.launchNetworks({ pendingOnly: true });
      await mapLimit(jobs, 2, async (job) => {
        const stages = job.instances.map((item) => item.stage).join(":");
        await mapLimit(job.instances, 2, async (item) => {
          try {
            await this.step(job, item);
          } catch (e) {
            item.stage = "failed";
            item.detail = scrubError(e);
          }
        });
        if (
          this.stopped ||
          this.store.launchNetwork(job.id)?.status !== "pending"
        )
          return;
        if (
          job.instances.every((item) => ["done", "failed"].includes(item.stage))
        ) {
          job.status = job.instances.some((item) => item.stage === "failed")
            ? "failed"
            : "success";
          job.completedAt = Date.now();
          this.completeAudit(job);
        }
        if (
          job.status !== "pending" ||
          stages !== job.instances.map((item) => item.stage).join(":")
        )
          this.invalidate(job);
        this.save(job);
      });
    } finally {
      this.busy = false;
    }
  }
}
