import * as LS from "@aws-sdk/client-lightsail";
import * as STS from "@aws-sdk/client-sts";
export const modules = { lightsail: LS, sts: STS };
export const clientNames = {
  lightsail: "LightsailClient",
  sts: "STSClient",
};
export const usedCommands = {
  lightsail: [
    "GetRegions",
    "GetInstances",
    "GetInstance",
    "StartInstance",
    "StopInstance",
    "RebootInstance",
    "SetIpAddressType",
    "DeleteInstance",
    "GetBlueprints",
    "GetBundles",
    "DownloadDefaultKeyPair",
    "GetInstanceAccessDetails",
    "CreateInstances",
    "GetStaticIps",
    "GetStaticIp",
    "AllocateStaticIp",
    "AttachStaticIp",
    "DetachStaticIp",
    "ReleaseStaticIp",
    "GetOperation",
    "GetInstanceMetricData",
    "GetInstancePortStates",
    "OpenInstancePublicPorts",
    "PutInstancePublicPorts",
    "CloseInstancePublicPorts",
  ],
  sts: ["GetCallerIdentity"],
};
