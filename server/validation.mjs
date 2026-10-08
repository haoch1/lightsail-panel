import { isIP } from "node:net";
import { z } from "zod";
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
    // New forms omit region. Keep the SDK endpoint internal and accept legacy clients.
    region: region.default("us-east-1"),
    authType: z.literal("keys").default("keys"),
    accessKeyId: z.string().max(128).optional(),
    secretAccessKey: z.string().max(256).optional(),
    sessionToken: z.string().max(8192).optional(),
    roleArn: z
      .string()
      .regex(/^arn:aws(?:-cn|-us-gov)?:iam::\d{12}:role\/.+/)
      .or(z.literal(""))
      .optional(),
    externalId: z.string().max(256).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.authType === "keys" && (!v.accessKeyId || !v.secretAccessKey))
      ctx.addIssue({
        code: "custom",
        message: "请输入 Access Key ID 和 Secret Access Key",
      });
  });
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
    userData: z.string().max(16000).default(""),
    token: z.string().uuid(),
  })
  .superRefine((v, ctx) => {
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
      protocol: z.enum(["tcp", "udp", "all", "icmp", "icmpv6"]),
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
