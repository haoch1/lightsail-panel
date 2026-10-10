import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.mjs";
import { AwsGateway } from "./aws.mjs";
import { Store } from "./store.mjs";
import { startRuntimeIdentity } from "./runtime-identity.mjs";
const stopIdentity = startRuntimeIdentity();
if (existsSync(resolve(".env"))) process.loadEnvFile(resolve(".env"));
const store = new Store(resolve(process.env.DATA_DIR || "data"));
const gateway = new AwsGateway(store);
const app = createApp(store, gateway);
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8090);
const server = app.listen(port, host, () =>
  console.log(`lightsail-panel: http://${host}:${port}`),
);
app.locals.ssh.attach(server);
function close() {
  stopIdentity();
  app.locals.ssh.close();
  gateway.invalidate();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
