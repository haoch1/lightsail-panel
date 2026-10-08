import type {
  AttachStaticIpCommandInput,
  CloseInstancePublicPortsCommandInput,
  CreateInstancesCommandInput,
  DetachStaticIpCommandInput,
  DownloadDefaultKeyPairCommandInput,
  GetBlueprintsCommandInput,
  GetBundlesCommandInput,
  GetInstanceMetricDataCommandInput,
  GetOperationCommandInput,
  GetRegionsCommandInput,
  OpenInstancePublicPortsCommandInput,
  ReleaseStaticIpCommandInput,
  SetIpAddressTypeCommandInput,
} from "@aws-sdk/client-lightsail";
import type { AssumeRoleCommandInput } from "@aws-sdk/client-sts";
export const contracts = [
  {} satisfies DownloadDefaultKeyPairCommandInput,
  {
    instanceName: "my-instance",
    metricName: "NetworkIn",
    period: 3600,
    unit: "Bytes",
    statistics: ["Sum"],
    startTime: new Date(),
    endTime: new Date(),
  } satisfies GetInstanceMetricDataCommandInput,
  { includeAvailabilityZones: true } satisfies GetRegionsCommandInput,
  {
    includeInactive: false,
    pageToken: "next",
  } satisfies GetBlueprintsCommandInput,
  {
    includeInactive: false,
    pageToken: "next",
  } satisfies GetBundlesCommandInput,
  {
    instanceNames: ["my-lightsail"],
    availabilityZone: "ap-northeast-1a",
    blueprintId: "ubuntu_24_04",
    bundleId: "small_3_0",
    userData: "#!/bin/bash",
    ipAddressType: "dualstack",
  } satisfies CreateInstancesCommandInput,
  {
    operationId: "00000000-0000-0000-0000-000000000000",
  } satisfies GetOperationCommandInput,
  {
    staticIpName: "my-ip",
    instanceName: "my-lightsail",
  } satisfies AttachStaticIpCommandInput,
  { staticIpName: "my-ip" } satisfies DetachStaticIpCommandInput,
  { staticIpName: "my-ip" } satisfies ReleaseStaticIpCommandInput,
  {
    instanceName: "my-lightsail",
    portInfo: {
      protocol: "tcp",
      fromPort: 8080,
      toPort: 8080,
      ipv6Cidrs: ["2001:db8::/64"],
    },
  } satisfies OpenInstancePublicPortsCommandInput,
  {
    instanceName: "my-lightsail",
    portInfo: {
      protocol: "tcp",
      fromPort: 8080,
      toPort: 8080,
      cidrs: ["198.51.100.1/32"],
    },
  } satisfies CloseInstancePublicPortsCommandInput,
  {
    RoleArn: "arn:aws:iam::123456789012:role/Panel",
    RoleSessionName: "lightsail-panel",
  } satisfies AssumeRoleCommandInput,
  {
    resourceType: "Instance",
    resourceName: "my-lightsail",
    ipAddressType: "dualstack",
    acceptBundleUpdate: false,
  } satisfies SetIpAddressTypeCommandInput,
];
