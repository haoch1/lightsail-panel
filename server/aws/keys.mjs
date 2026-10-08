import { decodePrivateKey } from "../security/ssh-key.mjs";
import { error } from "./shared.mjs";

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
