import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp, startServer } from "../dist/index.js";

const indexHtml = '<!doctype html><html><body><div id="root">Mycel</div></body></html>';

async function createWebApp(t) {
  const webDistPath = await mkdtemp(join(tmpdir(), "mycel-web-"));
  t.after(() => rm(webDistPath, { recursive: true, force: true }));
  await mkdir(join(webDistPath, "assets"));
  await writeFile(join(webDistPath, "index.html"), indexHtml);
  await writeFile(join(webDistPath, "assets/app.js"), 'console.log("Mycel");');
  return createApp({ webDistPath });
}

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

test("serves the frontend entry point and built assets from an absolute directory", async (t) => {
  const app = await createWebApp(t);
  const page = await app.request("/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.equal(await page.text(), indexHtml);

  const asset = await app.request("/assets/app.js");
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type"), /javascript/);
  assert.equal(await asset.text(), 'console.log("Mycel");');
});

test("browser navigation to client routes serves the frontend entry point", async (t) => {
  const app = await createWebApp(t);
  const response = await app.request("/graph/node-123", {
    headers: { Accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), indexHtml);
});

test("API misses and missing assets never fall back to frontend HTML", async (t) => {
  const app = await createWebApp(t);
  for (const path of ["/api", "/api/missing", "/assets/missing.js", "/assets/missing", "/missing.css"]) {
    const response = await app.request(path, { headers: { Accept: "text/html" } });
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.headers.get("content-type"), /text\/html/, path);
  }

  const response = await app.request("/graph", { method: "POST" });
  assert.equal(response.status, 404);
});

test("health still works when the frontend has not been built", async (t) => {
  const webDistPath = await mkdtemp(join(tmpdir(), "mycel-unbuilt-"));
  t.after(() => rm(webDistPath, { recursive: true, force: true }));
  const app = createApp({ webDistPath });
  const health = await app.request("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  const page = await app.request("/", { headers: { Accept: "text/html" } });
  assert.equal(page.status, 404);
});

test("project endpoint returns the selected repository rather than the server's directory", async () => {
  const project = { name: "selected-repository", root: "/projects/selected-repository" };
  const response = await createApp({ project }).request("/api/project");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), project);
});

test("project endpoint reports when no repository has been selected", async () => {
  const response = await createApp().request("/api/project");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "No repository selected" });
});
