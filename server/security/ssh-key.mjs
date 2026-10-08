import { createPrivateKey } from "node:crypto";
export function decodePrivateKey(encoded) {
  const pem = encoded?.startsWith("-----BEGIN ")
    ? encoded
    : Buffer.from(encoded || "", "base64").toString("utf8");
  try {
    if (!/^-----BEGIN (?:RSA )?PRIVATE KEY-----\r?\n/.test(pem)) throw Error();
    if (createPrivateKey(pem).asymmetricKeyType !== "rsa") throw Error();
  } catch {
    throw Object.assign(
      new Error("AWS 返回的 SSH 私钥格式无效，请检查区域与权限"),
      { status: 502 },
    );
  }
  return pem;
}
