import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startIndexedServer, startServer } from "../dist/index.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "mycel-server-start-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "repo");
  await mkdir(root);
  await writeFile(join(root, "sample.ts"), "export function sample() {}\n");
  return {
    project: { name: "fixture", root },
    databasePath: join(directory, "graph.sqlite"),
  };
}

const close = (server) =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

test("indexed startup exposes real repository queries immediately and closes storage on shutdown", async (t) => {
  const options = await fixture(t);
  const server = await startIndexedServer(0, options);
  t.after(async () => {
    if (server.listening) await close(server);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${url}/api/graph/search?q=sample`);
  assert.equal(response.status, 200);
  const node = (await response.json()).nodes.find((n) => n.name === "sample");
  assert.ok(node);
  const details = await fetch(`${url}/api/graph/nodes/${node.id}`);
  assert.equal((await details.json()).node.id, node.id);
  const neighborhood = await fetch(
    `${url}/api/graph/nodes/${node.id}/neighborhood`,
  );
  assert.equal((await neighborhood.json()).nodes.length, 2);
  await close(server);
  assert.equal(existsSync(`${options.databasePath}-wal`), false);
});

test("restarting the server retains unreadable source and exposes index warnings", async (t) => {
  const options = await fixture(t);
  const original = "export function legacy() {}";
  const legacy = join(options.project.root, "legacy.ts");
  await writeFile(legacy, original);
  await close(await startIndexedServer(0, options));

  const invalid = Buffer.from("export const invalid = true;", "utf16le");
  await writeFile(legacy, Buffer.concat([Buffer.from([0xff, 0xfe]), invalid]));
  await writeFile(
    join(options.project.root, "skipped.ts"),
    Buffer.from([0xff]),
  );
  const healthy = "export function updated() {}";
  await writeFile(join(options.project.root, "sample.ts"), healthy);

  const server = await startIndexedServer(0, options);
  t.after(() => close(server));
  const url = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 200);
  const { status, sourceWarnings } = await health.json();
  assert.equal(status, "ok");
  assert.equal(sourceWarnings.length, 2);
  assert.match(
    sourceWarnings[0],
    /^legacy\.ts: Showing the last indexed version/,
  );
  assert.match(sourceWarnings[1], /^skipped\.ts: Skipped file/);

  const retained = await fetch(`${url}/api/files/content?path=legacy.ts`);
  assert.equal(retained.status, 200);
  assert.equal((await retained.json()).content, original);
  const updated = await fetch(`${url}/api/files/content?path=sample.ts`);
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).content, healthy);
  const skipped = await fetch(`${url}/api/files/content?path=skipped.ts`);
  assert.equal(skipped.status, 404);
});

test("a busy port rejects startup and closes the indexed project's database", async (t) => {
  const options = await fixture(t);
  const busy = startServer(0);
  t.after(() => close(busy));
  await once(busy, "listening");
  await assert.rejects(startIndexedServer(busy.address().port, options), {
    code: "EADDRINUSE",
  });
  assert.equal(existsSync(`${options.databasePath}-wal`), false);
});
test("server shutdown closes active SSE streams before waiting for connections", async (t) => {
  const options = await fixture(t);
  const server = await startIndexedServer(0, options);
  t.after(() => {
    if (server.listening) {
      server.closeAllConnections();
      server.close();
    }
  });
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/events`,
  );
  const reader = response.body.getReader();
  await reader.read();
  await close(server);
  await reader.cancel();
  assert.equal(existsSync(`${options.databasePath}-wal`), false);
});
