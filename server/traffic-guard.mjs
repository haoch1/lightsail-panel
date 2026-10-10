import { randomUUID } from "node:crypto";
import { AUTO_REFRESH_MS, nextRefreshAt } from "../shared/refresh-policy.ts";
import { error, mapLimit, paginate, scrubError } from "./aws/shared.mjs";
export const TRAFFIC_CHECK_MS = AUTO_REFRESH_MS;
export const trafficLimitKey = (t) =>
  JSON.stringify([t.accountId, t.region, t.id]);

// Rules are opt-in, bound to the resource ARN, and independent of browser sessions.
// Persist intent before submitting StopInstance. An ambiguous response never
// causes a blind replay after a crash or restart.
export class TrafficGuard {
  constructor(store, gateway, onStop = () => {}, clock = Date.now) {
    Object.assign(this, {
      store,
      gateway,
      onStop,
      clock,
      busy: false,
      closed: false,
    });
    this.stop = () => {
      this.closed = true;
      clearTimeout(this.timer);
    };
    store.onClose.add(this.stop);
  }
  start() {
    const schedule = () => {
      if (this.closed) return;
      this.timer = setTimeout(
        () => {
          this.kick();
          schedule();
        },
        nextRefreshAt(this.clock()) - this.clock(),
      );
      this.timer.unref();
    };
    schedule();
    this.kick();
  }
  kick() {
    if (this.busy) {
      this.requested = true;
      return;
    }
    void this.tick().catch((e) => {
      if (!this.closed) console.error("Traffic guard:", scrubError(e));
    });
  }
  active(rule) {
    if (this.closed) return false;
    const current = this.store.trafficLimit(rule.key);
    return current?.enabled && current.revision === rule.revision;
  }
  saveProgress(rule, patch) {
    if (!this.active(rule)) return false;
    Object.assign(rule, this.store.trafficLimit(rule.key), patch);
    this.store.saveTrafficLimit(rule);
    return true;
  }
  async instance(t) {
    const account = this.store.account(t.accountId);
    const { instance } = await this.gateway.send(
      account,
      "lightsail",
      t.region,
      "GetInstance",
      { instanceName: t.id },
    );
    if (!instance?.arn || !instance.bundleId)
      throw error("无法确认实例身份与套餐", 409);
    return instance;
  }
  async allowance(t, bundleId) {
    const account = this.store.account(t.accountId);
    const bundles = await paginate(
      (p) =>
        this.gateway.send(account, "lightsail", t.region, "GetBundles", {
          ...p,
          includeInactive: true,
        }),
      "bundles",
      "nextPageToken",
      "pageToken",
    );
    const gb = bundles.find(
      (b) => b.bundleId === bundleId,
    )?.transferPerMonthInGb;
    if (!Number.isFinite(gb) || gb <= 0)
      throw error("当前套餐未返回有效流量额度，无法自动停止", 409);
    return gb * 1024 ** 3;
  }
  get(t) {
    return this.store.trafficLimit(trafficLimitKey(t));
  }
  async configure(input) {
    const key = trafficLimitKey(input);
    const previous = this.store.trafficLimit(key);
    this.store.account(input.accountId);
    // Turning a rule off works even when AWS is unavailable.
    let identity = previous?.instanceArn;
    let allowanceBytes = previous?.allowanceBytes;
    if (input.enabled) {
      const instance = await this.instance(input);
      identity = instance.arn;
      allowanceBytes = await this.allowance(input, instance.bundleId);
    }
    if (this.closed) throw error("面板服务正在关闭", 503);
    if (this.store.trafficLimit(key)?.revision !== previous?.revision)
      throw error("规则已被修改，请重新加载后保存", 409);
    const rule = {
      ...input,
      key,
      revision: randomUUID(),
      instanceArn: identity,
      allowanceBytes,
      status: input.enabled ? "waiting" : "disabled",
      nextCheckAt: this.clock(),
      updatedAt: new Date(this.clock()).toISOString(),
      lastStoppedAt: previous?.lastStoppedAt,
    };
    this.store.saveTrafficLimit(rule);
    this.store.audit({
      account: input.accountId,
      action: "traffic-limit",
      target: input.id,
      detail: input.enabled
        ? "启用本月入站＋出站阈值 " + input.thresholdPercent + "%"
        : "关闭流量自动停止",
    });
    return rule;
  }
  resourceUpdated(job) {
    if (this.closed || !(job.resources || []).includes("instances")) return;
    for (const item of job.instances.filter((i) => i.stage === "done")) {
      const rule = this.get({
        accountId: job.accountId,
        region: job.region,
        id: item.name,
      });
      if (!rule?.enabled || rule.lastResourceJob === job.id) continue;
      this.saveProgress(rule, {
        lastResourceJob: job.id,
        nextCheckAt: this.clock(),
        ...(job.action === "stop" ? { pendingStop: false } : {}),
      });
    }
    this.kick();
  }
  async tick() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      await mapLimit(
        this.store
          .trafficLimits()
          .filter(
            (r) =>
              r.enabled &&
              r.status !== "paused" &&
              (r.nextCheckAt || 0) <= this.clock(),
          ),
        2,
        (r) => this.check(r),
      );
    } finally {
      this.busy = false;
      if (this.requested && !this.closed) {
        this.requested = false;
        this.kick();
      }
    }
  }
  async check(rule) {
    const now = this.clock();
    if (!this.saveProgress(rule, { nextCheckAt: nextRefreshAt(now) })) return;
    try {
      const instance = await this.instance(rule);
      if (!this.active(rule)) return;
      if (instance.arn !== rule.instanceArn) {
        this.saveProgress(rule, {
          status: "paused",
          detail: "实例身份已变化，请核对后重新保存规则",
        });
        return;
      }
      if (instance.state?.name !== "running") {
        this.saveProgress(rule, {
          status: instance.state?.name === "stopped" ? "stopped" : "waiting",
          detail: "当前实例状态：" + (instance.state?.name || "未知"),
          checkedAt: new Date(now).toISOString(),
          ...(instance.state?.name === "stopped" ? { pendingStop: false } : {}),
        });
        return;
      }
      if (rule.pendingStop) {
        this.saveProgress(rule, {
          status: "uncertain",
          detail:
            "停止请求已提交，但尚未确认结果；请核对实例状态，重新保存可重试",
          checkedAt: new Date(now).toISOString(),
        });
        return;
      }
      const [allowanceBytes, traffic] = await Promise.all([
        this.allowance(rule, instance.bundleId),
        this.gateway.traffic(
          rule,
          "month",
          new Date(now),
          rule.utcOffsetMinutes,
        ),
      ]);
      if (!this.active(rule)) return;
      const usedBytes = traffic.totals.combined;
      if (
        traffic.warnings?.length ||
        usedBytes === null ||
        !Number.isFinite(usedBytes) ||
        usedBytes < 0
      )
        throw error("流量数据不完整，本次不会自动停止；等待下次检查");
      const usedPercent = (usedBytes / allowanceBytes) * 100;
      this.saveProgress(rule, {
        allowanceBytes,
        usedBytes,
        usedPercent,
        periodStart: traffic.start,
        metricEnd: traffic.end,
        checkedAt: new Date(now).toISOString(),
        status: "monitoring",
        detail: "",
      });
      if (usedPercent < rule.thresholdPercent) return;
      // Recheck identity/state immediately before the mutation. Rule revision is
      // checked again after awaits so disabling/editing cancels in-flight work.
      const current = await this.instance(rule);
      if (
        !this.active(rule) ||
        current.arn !== rule.instanceArn ||
        current.bundleId !== instance.bundleId ||
        current.state?.name !== "running"
      )
        return;
      if (!this.saveProgress(rule, { pendingStop: true, status: "stopping" }))
        return;
      const target = {
        accountId: rule.accountId,
        region: rule.region,
        id: rule.id,
        service: "lightsail",
        action: "stop",
      };
      const result = await this.gateway.perform(target);
      if (this.closed) return;
      this.store.audit({
        account: rule.accountId,
        action: "traffic-auto-stop",
        target: rule.id,
        detail:
          "本月入站＋出站达到 " +
          usedPercent.toFixed(2) +
          "%，阈值 " +
          rule.thresholdPercent +
          "%",
      });
      this.saveProgress(rule, {
        lastStoppedAt: new Date(now).toISOString(),
        detail: "达到流量阈值，已提交停止请求",
      });
      this.onStop(target, result);
    } catch (e) {
      if (!this.active(rule)) return;
      const denied = [
        "AccessDeniedException",
        "UnauthorizedException",
        "UnauthenticatedException",
        "UnrecognizedClientException",
      ].includes(e.name);
      const detail = scrubError(e);
      this.saveProgress(rule, {
        status:
          denied || e.name === "NotFoundException"
            ? "paused"
            : rule.pendingStop
              ? "uncertain"
              : "error",
        pendingStop: denied ? false : !!rule.pendingStop,
        checkedAt: new Date(now).toISOString(),
        detail: denied
          ? "权限或凭证校验失败，规则已暂停；处理后重新保存。 " + detail
          : detail,
      });
      // Log changes in the error rather than the same failure on every scheduled check.
      if (rule.lastError !== detail) {
        this.store.audit({
          account: rule.accountId,
          action: "traffic-auto-stop-check",
          target: rule.id,
          status: "failed",
          detail,
        });
        this.saveProgress(rule, { lastError: detail });
      }
    }
  }
}
