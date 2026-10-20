import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createApp, startServer } from "../dist/index.js";

test("health responds with JSON over a loopback HTTP connection", async (t) => {
  const server = startServer(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");
  assert.equal(address.address, "127.0.0.1");

  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("unknown routes return 404", async () => {
  const response = await createApp().request("/api/missing");
  assert.equal(response.status, 404);
});
