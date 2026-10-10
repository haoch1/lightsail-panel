import { isIP } from "node:net";
import { z } from "zod";
import { normalizeProtocol } from "../shared/firewall.ts";
export const region = z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/);
export const service = z.literal("lightsail").default("lightsail");
export const target = z.object({
  accountId: z.string().min(1),
  region,
  service,
  id: z.string().min(1).max(255),
});
export const account = z
  .object({
    name: z.string().min(1).max(80),
    accessKeyId: z.string().min(1).max(128),
    secretAccessKey: z.string().min(1).max(256),
  })
  .strict()
  .transform((v) => ({ ...v, authType: "keys", region: "us-east-1" }));
export const sessionHours = z.number().int().min(1).max(2160);
export const trafficLimit = target
  .extend({
    enabled: z.boolean(),
    thresholdPercent: z.number().min(0.1).max(100),
    utcOffsetMinutes: z.number().int().min(-720).max(840).default(0),
  })
  .strict();
export const action = target.extend({
  action: z.enum([
    "start",
    "stop",
    "reboot",
    "terminate",
    "rotate-ip",
    "enable-ipv6",
    "disable-ipv6",
  ]),
  confirm: z.string().optional(),
  acceptBundleUpdate: z.boolean().default(false),
});
export const launch = z
  .object({
    accountId: z.string().min(1),
    region,
    service,
    name: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_-]*[a-zA-Z0-9_]$/),
    imageId: z.string().min(1),
    instanceType: z.string().min(1),
    count: z.number().int().min(1).max(20).default(1),
    keyName: z.enum(["", "LightsailDefaultKeyPair"]).optional(),
    zone: z.string().optional(),
    ipAddressType: z.enum(["dualstack", "ipv4", "ipv6"]).default("dualstack"),
    firewall: z
      .array(z.lazy(() => publicPorts.shape.portInfo))
      .min(1)
      .max(60)
      .optional(),
    allocateStaticIp: z.boolean().default(false),
    userData: z.string().max(16000).default(""),
    token: z.string().uuid(),
  })
  .superRefine((v, ctx) => {
    if (v.allocateStaticIp && v.ipAddressType === "ipv6")
      ctx.addIssue({
        code: "custom",
        message: "仅 IPv6 实例不能分配静态 IPv4",
        path: ["allocateStaticIp"],
      });
    for (const [index, portInfo] of (v.firewall || []).entries()) {
      const checked = publicPorts.safeParse({
        accountId: v.accountId,
        region: v.region,
        service: v.service,
        id: v.name,
        portInfo,
      });
      if (!checked.success)
        for (const issue of checked.error.issues)
          ctx.addIssue({
            ...issue,
            path: [
              "firewall",
              index,
              ...issue.path.filter((p) => p !== "portInfo"),
            ],
          });
      if (
        (v.ipAddressType === "ipv6" || portInfo.protocol === "icmpv6") &&
        portInfo.cidrs?.length
      )
        ctx.addIssue({
          code: "custom",
          message: "此规则只能使用 IPv6 来源",
          path: ["firewall", index],
        });
      if (
        (v.ipAddressType === "ipv4" || portInfo.protocol === "icmp") &&
        portInfo.ipv6Cidrs?.length
      )
        ctx.addIssue({
          code: "custom",
          message: "此规则只能使用 IPv4 来源",
          path: ["firewall", index],
        });
    }
    if (v.userData.includes("root:你的密码"))
      ctx.addIssue({
        code: "custom",
        message: "请替换启动脚本中的“你的密码”，或清空脚本",
        path: ["userData"],
      });
    if (v.count > 1 && v.name.length + 1 + String(v.count).length > 63)
      ctx.addIssue({
        code: "custom",
        message: "多实例名称加上序号后不能超过 63 位",
      });
  });
export const staticIp = z
  .object({
    accountId: z.string().min(1),
    region,
    name: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_-]*[a-zA-Z0-9_]$/),
    action: z.enum(["allocate", "attach", "detach", "release"]),
    instanceName: z.string().optional(),
    confirm: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "attach" && !v.instanceName)
      ctx.addIssue({ code: "custom", message: "请选择目标实例" });
  });
export const publicPorts = target
  .extend({
    close: z.boolean().default(false),
    portInfo: z.object({
      protocol: z
        .union([z.string(), z.number()])
        .transform(normalizeProtocol)
        .pipe(z.enum(["tcp", "udp", "all", "icmp", "icmpv6"])),
      fromPort: z.number().int().min(-1).max(65535),
      toPort: z.number().int().min(-1).max(65535),
      cidrs: z.array(z.string()).max(60).optional(),
      ipv6Cidrs: z.array(z.string()).max(60).optional(),
      cidrListAliases: z.array(z.string().min(1).max(128)).max(10).optional(),
    }),
  })
  .superRefine((v, ctx) => {
    const p = v.portInfo;
    if (
      ["tcp", "udp", "all"].includes(p.protocol) &&
      (p.fromPort < 0 || p.fromPort > p.toPort)
    )
      ctx.addIssue({ code: "custom", message: "端口范围无效" });
    if (
      ["icmp", "icmpv6"].includes(p.protocol) &&
      (p.fromPort > 255 ||
        p.toPort > 255 ||
        (p.fromPort === -1 && p.toPort !== -1))
    )
      ctx.addIssue({ code: "custom", message: "ICMP 类型或代码无效" });
    for (const [field, family, max] of [
      ["cidrs", 4, 32],
      ["ipv6Cidrs", 6, 128],
    ])
      for (const cidr of p[field] || []) {
        const match = /^(.+)\/(\d+)$/.exec(cidr);
        if (!match || isIP(match[1]) !== family || Number(match[2]) > max)
          ctx.addIssue({
            code: "custom",
            message: "请输入有效的 IPv4 / IPv6 CIDR",
          });
      }
    if (
      !v.close &&
      !(p.cidrs?.length || p.ipv6Cidrs?.length || p.cidrListAliases?.length)
    )
      ctx.addIssue({ code: "custom", message: "请指定允许访问的来源网段" });
  });
