import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "@mycel/db";
import { createGraphQueries, indexRepository } from "../dist/index.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "mycel-features-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = new URL("fixtures/feature-discovery/", import.meta.url);
  const sources = new Map();
  for (const name of await readdir(directory, { recursive: true })) {
    if (!name.endsWith(".txt")) continue;
    const path = name.slice(0, -4);
    const source = await readFile(new URL(name, directory), "utf8");
    sources.set(path, source);
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), source);
  }
  const database = openDatabase({ databasePath: ":memory:" });
  t.after(() => database.close());
  return { project: { root, name: "features" }, database, root, sources };
}

test("unannotated fixture recognizes Next layouts and only called exported service candidates", async (t) => {
  const input = await fixture(t);
  const indexed = await indexRepository(input);
  const graph = createGraphQueries(
    input.database,
    indexed.projectId,
  ).getSemanticGraph(500);
  const operations = graph.entities.filter(
    (entity) => entity.kind === "service_operation",
  );
  assert.deepEqual(operations.map((entity) => entity.name).sort(), [
    "loadBilling",
    "loadOrders",
    "send",
  ]);
  assert.ok(
    operations.every(
      (entity) =>
        entity.provenance.kind === "heuristic" &&
        entity.attributes.status === "candidate",
    ),
  );
  assert.ok(
    graph.entities.some(
      (entity) =>
        entity.kind === "component" && entity.name === "WorkspaceLayout",
    ),
  );
  const shared = operations.find((entity) => entity.name === "send");
  assert.equal(
    graph.relationships.filter(
      (edge) => edge.kind === "CALLS" && edge.targetId === shared.id,
    ).length,
    2,
  );
  for (const operation of operations) {
    const source = operation.sources[0];
    assert.ok(
      input.sources
        .get(source.path)
        .slice(source.range.start, source.range.end)
        .includes(operation.name),
    );
  }
});
