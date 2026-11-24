import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "@mycel/db";
import { openIndexedProject } from "../dist/index.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "mycel-project-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "repo");
  await mkdir(root);
  await writeFile(join(root, "sample.ts"), "export function sample() {}\n");
  return {
    project: { name: "fixture", root },
    databasePath: join(directory, "graph.sqlite"),
  };
}

test("opening a project indexes before exposing queries and close is idempotent", async (t) => {
  const { project } = await fixture(t);
  const indexed = await openIndexedProject({
    project,
    databasePath: ":memory:",
  });
  t.after(indexed.close);
  const search = indexed.graph.searchSymbols({ q: "sample" });
  assert.equal(search.revision, 1);
  assert.equal(search.projectId, indexed.project.id);
  const node = search.nodes.find((n) => n.name === "sample");
  assert.ok(node);
  assert.equal(
    indexed.graph.getNodeDetails(node.id).relatedFiles.nodes.length,
    1,
  );
  assert.equal(indexed.graph.getNeighborhood(node.id).nodes.length, 2);
  indexed.close();
  indexed.close();
  assert.throws(() => indexed.graph.searchSymbols({ q: "sample" }), /not open/);
});

test("reopening a project persists revisions and indexes current source", async (t) => {
  const options = await fixture(t);
  const first = await openIndexedProject(options);
  t.after(first.close);
  const projectId = first.project.id;
  first.close();
  assert.equal(existsSync(`${options.databasePath}-wal`), false);
  await writeFile(
    join(options.project.root, "sample.ts"),
    "export function renamed() {}\n",
  );
  const second = await openIndexedProject(options);
  t.after(second.close);
  const search = second.graph.searchSymbols({ q: "renamed" });
  assert.equal(second.project.id, projectId);
  assert.equal(search.revision, 2);
  assert.equal(search.nodes[0].name, "renamed");
  assert.ok(
    !second.graph
      .searchSymbols({ q: "sample" })
      .nodes.some((n) => n.name === "sample"),
  );
});

test("failed startup closes storage and preserves the previous committed graph", async (t) => {
  const options = await fixture(t);
  const indexed = await openIndexedProject(options);
  const projectId = indexed.project.id;
  indexed.close();
  const previous = openDatabase({
    projectRoot: options.project.root,
    databasePath: options.databasePath,
  });
  try {
    previous.exec(`
      CREATE TRIGGER fail_startup BEFORE INSERT ON revisions
      BEGIN SELECT RAISE(ABORT, 'startup index write failed'); END;
    `);
  } finally {
    previous.close();
  }
  await assert.rejects(
    openIndexedProject(options),
    /startup index write failed/,
  );
  assert.equal(existsSync(`${options.databasePath}-wal`), false);
  const database = openDatabase({
    projectRoot: options.project.root,
    databasePath: options.databasePath,
  });
  t.after(() => database.close());
  assert.equal(
    database
      .prepare(
        "SELECT MAX(revision) AS revision FROM revisions WHERE project_id = ?",
      )
      .get(projectId).revision,
    1,
  );
  assert.ok(
    database
      .prepare("SELECT id FROM nodes WHERE project_id = ? AND name = 'sample'")
      .get(projectId),
  );
});

test("project lifecycle exposes live update measurements with query revisions", async (t) => {
  const options = await fixture(t);
  const indexed = await openIndexedProject(options);
  t.after(indexed.close);
  assert.equal(indexed.lastUpdate, undefined);
  await writeFile(
    join(options.project.root, "sample.ts"),
    "export function saved() {}",
  );
  // flush only processes already observed events; wait for OS delivery.
  const { setTimeout } = await import("node:timers/promises");
  const deadline = Date.now() + 5000;
  while (!indexed.lastUpdate) {
    if (Date.now() > deadline) assert.fail("Timed out waiting for live update");
    await setTimeout(20);
  }
  await indexed.flush();
  assert.equal(
    indexed.lastUpdate.revision,
    indexed.graph.searchSymbols({ q: "saved" }).revision,
  );
  assert.equal(
    indexed.graph.searchSymbols({ q: "saved" }).nodes[0].name,
    "saved",
  );
});
