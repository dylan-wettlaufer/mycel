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
