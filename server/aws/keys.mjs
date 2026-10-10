import { decodePrivateKey } from "../security/ssh-key.mjs";
import { error } from "./shared.mjs";

export async function instanceAccessDetails(gateway, target) {
  const account = gateway.store.account(target.accountId);
  const { instance } = await gateway.send(
    account,
    "lightsail",
    target.region,
    "GetInstance",
    {
      instanceName: target.id,
    },
  );
  if (instance?.state?.name !== "running")
    throw error("实例尚未运行，请启动后再连接 SSH", 409);
  const { accessDetails } = await gateway.send(
    account,
    "lightsail",
    target.region,
    "GetInstanceAccessDetails",
    {
      instanceName: target.id,
      protocol: "ssh",
    },
  );
  if (!accessDetails || accessDetails.instanceName !== target.id)
    throw error("AWS 未返回目标实例的 SSH 凭证", 502);
  return accessDetails;
}

export async function downloadDefaultKeyPair(gateway, accountId, region) {
  const account = gateway.store.account(accountId);
  const result = await gateway.send(
    account,
    "lightsail",
    region,
    "DownloadDefaultKeyPair",
    {},
  );
  if (!result.privateKeyBase64)
    throw error("AWS 未返回默认 SSH 私钥，请检查区域与权限", 502);
  const privateKey = decodePrivateKey(result.privateKeyBase64);
  return { filename: `LightsailDefaultKey-${region}.pem`, privateKey };
}
