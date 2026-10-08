import type { Catalog, Region } from "../../shared/types";
import { awsRegionOptions } from "../../shared/regions";
export { awsRegionOptions, regionNames } from "../../shared/regions";
// Account setup uses this official Lightsail region list before credentials are available;
// the demo reuses it, while connected account catalogs come from AWS.
export const demoRegions: Region[] = awsRegionOptions.map(
  ({ id, name, optIn }) => ({
    id,
    name,
    zones:
      id === "ap-northeast-1"
        ? [id + "a", id + "c", id + "d"]
        : [id + "a", id + "b", id + "c"],
    optIn,
  }),
);
const operatingSystems = [
  ["debian_13", "Debian 13"],
  ["debian_12", "Debian 12"],
  ["ubuntu_24_04", "Ubuntu 24.04 LTS"],
  ["ubuntu_22_04", "Ubuntu 22.04 LTS"],
  ["centos_stream_9", "CentOS Stream 9"],
];
const sizes = [
  {
    id: "nano",
    cpu: 2,
    memory: 0.5,
    disk: 20,
    transfer: 1024,
    v4: 5,
    v6: 3.5,
  },
  {
    id: "micro",
    cpu: 2,
    memory: 1,
    disk: 40,
    transfer: 2048,
    v4: 7,
    v6: 5,
  },
  {
    id: "small",
    cpu: 2,
    memory: 2,
    disk: 60,
    transfer: 3072,
    v4: 12,
    v6: 10,
  },
  {
    id: "medium",
    cpu: 2,
    memory: 4,
    disk: 80,
    transfer: 4096,
    v4: 24,
    v6: 20,
  },
  {
    id: "large",
    cpu: 2,
    memory: 8,
    disk: 160,
    transfer: 5120,
    v4: 44,
    v6: 40,
  },
  {
    id: "xlarge",
    cpu: 4,
    memory: 16,
    disk: 320,
    transfer: 6144,
    v4: 84,
    v6: 80,
  },
  {
    id: "2xlarge",
    cpu: 8,
    memory: 32,
    disk: 640,
    transfer: 7168,
    v4: 164,
    v6: 160,
  },
  {
    id: "4xlarge",
    cpu: 16,
    memory: 64,
    disk: 1280,
    transfer: 8192,
    v4: 384,
    v6: 380,
  },
];
export const demoCatalog: Omit<Catalog, "zones"> = {
  images: [
    ...operatingSystems.map(([id, name]) => ({
      id,
      name,
      type: "os",
      platform: "LINUX_UNIX",
      minPower: 1,
    })),
  ],
  types: sizes.flatMap((s, index) =>
    ["v4", "v6"].map((kind) => ({
      id: s.id + (kind === "v6" ? "_ipv6_3_0" : "_3_0"),
      name: `${s.cpu} vCPU / ${s.memory} GB / ${s.disk} GB SSD · $${s[kind as "v4" | "v6"]}/月 · ${kind === "v6" ? "仅 IPv6" : "含公网 IPv4"} · ${s.transfer} GB 流量`,
      price: s[kind as "v4" | "v6"],
      platforms: ["LINUX_UNIX"],
      power: index + 1,
      ipv4: kind !== "v6",
      cpu: s.cpu,
      memory: s.memory,
      disk: s.disk,
      transfer: s.transfer,
    })),
  ),
  warnings: [
    "演示镜像依据 AWS 官方文档：Debian 13/12、Ubuntu 24.04/22.04、CentOS Stream 9。真实可用版本、规格与价格以当前账户和区域的 AWS 返回为准。",
  ],
};
