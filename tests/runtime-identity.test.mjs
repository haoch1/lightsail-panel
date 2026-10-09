import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const run = promisify(execFile);
const identityUrl = new URL("../server/runtime-identity.mjs", import.meta.url)
  .href;
const launcher = fileURLToPath(
  new URL("../bin/lightsail-panel.mjs", import.meta.url),
);

test("runtime identity sets the process title without keeping a process alive", async () => {
  const { stdout, stderr } = await run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const { startRuntimeIdentity } = await import(${JSON.stringify(identityUrl)});
       startRuntimeIdentity();
       console.log(JSON.stringify(process.title));`,
    ],
    { timeout: 5000 },
  );
  assert.equal(JSON.parse(stdout), "lightsail-panel");
  assert.equal(stderr, "");
});

test(
  "Linux process and existing/later-created worker threads use the runtime name",
  { skip: process.platform !== "linux" },
  async () => {
    const { stdout, stderr } = await run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import assert from "node:assert/strict";
         import { readFileSync, readdirSync } from "node:fs";
         import { pbkdf2 } from "node:crypto";
         import { once } from "node:events";
         import { setTimeout } from "node:timers/promises";
         import { promisify } from "node:util";
         import { Worker } from "node:worker_threads";
         const { startRuntimeIdentity } = await import(${JSON.stringify(identityUrl)});
         const stop = startRuntimeIdentity({ intervalMs: 20 });
         const before = readdirSync("/proc/self/task");
         const names = () => readdirSync("/proc/self/task").map(tid =>
           readFileSync("/proc/self/task/" + tid + "/comm", "utf8").trim());
         assert(names().every(name => name === "lightsail-panel"));
         await promisify(pbkdf2)("test", "salt", 1000, 16, "sha256");
         const worker = new Worker("setInterval(() => {}, 1000)", { eval: true });
         await once(worker, "online");
         assert(readdirSync("/proc/self/task").some(tid => !before.includes(tid)));
         const deadline = Date.now() + 3000;
         while (!names().every(name => name === "lightsail-panel") && Date.now() < deadline) {
           await setTimeout(25);
         }
         assert(names().every(name => name === "lightsail-panel"));
         assert.equal(readFileSync("/proc/self/comm", "utf8").trim(), "lightsail-panel");
         assert.deepEqual(readFileSync("/proc/self/cmdline", "utf8").split("\\0").filter(Boolean), ["lightsail-panel"]);
         await worker.terminate();
         stop();
         console.log("ok");`,
      ],
      { timeout: 7000 },
    );
    assert.equal(stdout.trim(), "ok");
    assert.equal(stderr, "");
  },
);

test("named launcher healthcheck checks both HTTP status and health response", async (t) => {
  let status = 200;
  let ok = true;
  const server = createServer((req, res) => {
    assert.equal(req.url, "/api/health");
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const args = [launcher, "--healthcheck"];
  const options = {
    env: { ...process.env, PORT: String(server.address().port) },
    timeout: 7000,
  };
  await run(process.execPath, args, options);
  ok = false;
  await assert.rejects(run(process.execPath, args, options), { code: 1 });
  status = 503;
  ok = true;
  await assert.rejects(run(process.execPath, args, options), { code: 1 });
  await new Promise((resolve) => server.close(resolve));
  await assert.rejects(run(process.execPath, args, options), { code: 1 });
});
