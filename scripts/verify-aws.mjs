// Read-only validation against a real account. No resource mutation is performed.
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Store } from "../server/store.mjs";
import { AwsGateway, scrubError } from "../server/aws.mjs";
if (existsSync(resolve(".env"))) process.loadEnvFile(resolve(".env"));
const store = new Store(resolve(process.env.DATA_DIR || "data"));
const gateway = new AwsGateway(store);
try {
  const id = process.env.VERIFY_ACCOUNT_ID || store.accounts()[0]?.id;
  if (!id) throw Error("请先在面板中添加 AWS 账户，或设置 VERIFY_ACCOUNT_ID。");
  const a = store.account(id);
  const region = process.env.VERIFY_REGION || a.region;
  const identity = await gateway.identity(a.credentials, region);
  console.log(
    "STS identity: OK (account …" + identity.awsAccountId.slice(-4) + ")",
  );
  for (const service of ["lightsail"]) {
    try {
      const regions = await gateway.regions(a, service);
      console.log(service + " regions: " + regions.length);
      const rows = await gateway.instances(a, service, region);
      console.log(
        service +
          " " +
          region +
          ": " +
          rows.length +
          " instances; pagination OK",
      );
    } catch (e) {
      console.error(service + ": " + scrubError(e));
      process.exitCode = 1;
    }
  }
} catch (e) {
  console.error(scrubError(e));
  process.exitCode = 1;
} finally {
  gateway.invalidate();
  store.close();
}
