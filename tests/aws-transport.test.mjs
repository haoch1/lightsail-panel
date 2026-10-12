import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { options } from "../server/aws/transport.mjs";

test("AWS HTTP requests abort on their deadline instead of only logging a warning", async (t) => {
  const server = createServer(() => {});
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const handler = options(
    {},
    { credentials: { accessKeyId: "QA", secretAccessKey: "QA" } },
    "us-east-1",
  ).requestHandler;
  t.after(() => {
    handler.destroy();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  handler.updateHttpClientConfig("requestTimeout", 40);
  await assert.rejects(
    handler.handle({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/",
      method: "GET",
      headers: {},
    }),
    (error) => error.name === "TimeoutError" && error.code === "ETIMEDOUT",
  );
});
