import { NodeHttpHandler } from "@smithy/node-http-handler";
import { randomUUID } from "node:crypto";
import { clientNames, modules } from "./sdk.mjs";
import { error } from "./shared.mjs";

export function options(gateway, account, region) {
  const { credentials: c } = account;
  const options = { region, maxAttempts: 3 };
  options.credentials = {
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
  };
  options.requestHandler = new NodeHttpHandler({
    connectionTimeout: 5000,
    requestTimeout: 25000,
  });
  return options;
}

export async function client(gateway, account, service, region) {
  if (!modules[service]) throw error("此面板仅支持 Lightsail", 400);
  const key = `${account.id}:${service}:${region}`;
  const cached = gateway.clients.get(key);
  if (cached && cached.expires > Date.now()) return cached.client;
  if (cached) cached.client.destroy();
  const options = gateway.options(account, region);
  const client = new modules[service][clientNames[service]](options);
  gateway.clients.set(key, { client, expires: Date.now() + 10 * 60000 });
  return client;
}

export async function send(
  gateway,
  account,
  service,
  region,
  command,
  input = {},
) {
  const client = await gateway.client(account, service, region);
  return client.send(new modules[service][command + "Command"](input));
}

export async function identity(gateway, credentials, region) {
  const account = { id: randomUUID(), credentials, region };
  try {
    const r = await gateway.send(account, "sts", region, "GetCallerIdentity");
    return { awsAccountId: r.Account, arn: r.Arn };
  } finally {
    for (const [key, entry] of gateway.clients)
      if (key.startsWith(account.id + ":")) {
        entry.client.destroy();
        gateway.clients.delete(key);
      }
  }
}
