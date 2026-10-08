import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["server/index.mjs"], {
    stdio: "inherit",
    env: { ...process.env, PORT: process.env.PORT || "4180" },
  }),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "4173",
      "--strictPort",
    ],
    { stdio: "inherit" },
  ),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const c of children) {
  c.on("error", (e) => {
    console.error(e.message);
    close(1);
  });
  c.on("exit", (code) => close(code || 0));
}
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
