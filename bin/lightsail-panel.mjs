#!/usr/bin/env node
import { startRuntimeIdentity } from "../server/runtime-identity.mjs";

const args = process.argv.slice(2);
if (args.length === 0) {
  await import("../server/index.mjs");
} else if (args.length === 1 && args[0] === "--healthcheck") {
  const stopIdentity = startRuntimeIdentity();
  try {
    const port = Number(process.env.PORT || 8090);
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(4000),
    });
    process.exitCode =
      response.ok && (await response.json()).ok === true ? 0 : 1;
  } catch {
    process.exitCode = 1;
  } finally {
    stopIdentity();
  }
} else {
  console.error("Usage: lightsail-panel [--healthcheck]");
  process.exitCode = 2;
}
