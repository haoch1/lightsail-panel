export interface Account {
  id: string;
  name: string;
  /** Internal SDK/discovery endpoint; resource regions are selected separately. */
  region: string;
  awsAccountId: string;
  arn?: string;
  authType: "keys";
  keyHint: string;
  addedAt?: string;
}
export interface Instance {
  id: string;
  name: string;
  service: "lightsail";
  accountId: string;
  accountName: string;
  region: string;
  state: string;
  instanceType: string;
  platform: string;
  publicIp?: string;
  privateIp?: string;
  ipv6?: string[];
  cpu?: number;
  memory?: number;
  createdAt?: string;
  zone?: string;
  imageId?: string;
  keyName?: string;
  sshUser?: string;
  staticIp?: boolean;
  ipAddressType?: string;
}
export interface Region {
  id: string;
  name: string;
  zones?: string[];
  optIn?: boolean;
}
export interface Catalog {
  images: {
    id: string;
    name: string;
    platform?: string;
    type?: string;
    version?: string;
    description?: string;
    minPower?: number;
  }[];
  types: {
    id: string;
    name: string;
    price?: number;
    platforms?: string[];
    power?: number;
    ipv4?: boolean;
    cpu?: number;
    memory?: number;
    disk?: number;
    transfer?: number;
  }[];
  zones: string[];
  warnings?: string[];
}
export interface ResourceScan<T> {
  items: T[];
  errors: {
    account: string;
    accountId?: string;
    region: string;
    message: string;
    kind?: "connection" | "http";
  }[];
  unavailable?: { account: string; region: string; message: string }[];
  at: string;
  scanned: number;
}
export type Scan = ResourceScan<Instance>;
export interface TrafficData {
  utcOffsetMinutes?: number;
  start: string;
  end: string;
  at: string;
  period: number;
  totals: {
    inbound: number | null;
    outbound: number | null;
    combined: number | null;
  };
  samples: { inbound: number; outbound: number };
  daily: { date: string; inbound: number | null; outbound: number | null }[];
  warnings: string[];
}
export interface StaticIp {
  name: string;
  ipAddress: string;
  isAttached: boolean;
  attachedTo?: string;
  createdAt?: string;
}
export interface ScopedStaticIp extends StaticIp {
  accountId: string;
  accountName: string;
  region: string;
}
export interface PortInfo {
  fromPort: number;
  toPort: number;
  protocol: string;
  cidrs?: string[];
  ipv6Cidrs?: string[];
  cidrListAliases?: string[];
}
export interface LaunchNetworkJob {
  id: string;
  accountId: string;
  region: string;
  action?: string;
  resources?: string[];
  status: "pending" | "success" | "failed";
  completedAt?: number;
  at?: number;
  targetInstance?: string;
  instances: {
    name: string;
    stage: string;
    detail?: string;
    staticIpName?: string;
  }[];
}
export interface AuditEntry {
  id: string | number;
  at: string;
  action: string;
  status: string;
  account?: string;
  target?: string;
  detail?: string;
}
export type ToastFn = (
  message: string,
  type?: "success" | "error" | "info",
) => void;

export interface TrafficLimitRule {
  enabled: boolean;
  thresholdPercent: number;
  utcOffsetMinutes: number;
  status: string;
  allowanceBytes?: number;
  usedBytes?: number;
  usedPercent?: number;
  checkedAt?: string;
  metricEnd?: string;
  lastStoppedAt?: string;
  detail?: string;
}
