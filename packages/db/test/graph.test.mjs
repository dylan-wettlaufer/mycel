import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase, replaceProjectGraph } from "../dist/index.js";

test("project replacement rejects cross-project input, identity reassignment, and disabled foreign keys", (t) => {
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  const project = {
    id: "project",
    name: "fixture",
    root: "/projects/fixture",
    indexing: { extensions: [".ts"], exclude: [], respectGitignore: true },
  };
  const node = {
    id: "file",
    projectId: project.id,
    kind: "file",
    name: "empty.ts",
    qualifiedName: "empty.ts",
    path: "empty.ts",
    contentHash: "0".repeat(64),
    range: {
      start: 0,
      end: 0,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 1,
      id: "unexpected-id",
      projectId: "unexpected-project",
    },
  };
  const graph = { project, nodes: [node], edges: [], diagnostics: [] };
  const beforeInput = structuredClone(graph);
  assert.equal(replaceProjectGraph(db, graph), 1);
  assert.deepEqual(graph, beforeInput);
  assert.equal(db.prepare("SELECT id FROM nodes").get().id, node.id);
  const before = db.prepare("SELECT * FROM nodes").all();
  assert.throws(
    () =>
      replaceProjectGraph(db, {
        ...graph,
        nodes: [{ ...node, projectId: "other" }],
      }),
    /belong/,
  );
  assert.throws(
    () =>
      replaceProjectGraph(db, {
        ...graph,
        edges: [
          {
            id: "edge",
            projectId: "other",
            kind: "CALLS",
            sourceId: "file",
            targetId: "file",
          },
        ],
      }),
    /belong/,
  );
  assert.throws(
    () =>
      replaceProjectGraph(db, {
        ...graph,
        project: { ...project, root: "/projects/different" },
      }),
    /reassigned/,
  );
  db.pragma("foreign_keys = OFF");
  assert.throws(() => replaceProjectGraph(db, graph), /foreign keys/);
  db.pragma("foreign_keys = ON");
  assert.deepEqual(db.prepare("SELECT * FROM nodes").all(), before);
  assert.equal(
    db.prepare("SELECT MAX(revision) AS revision FROM revisions").get()
      .revision,
    1,
  );
});

test("incremental reconciliation commits one revision and atomically rolls back late diagnostic failures", async (t) => {
  const { applyProjectGraph } = await import("../dist/index.js");
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  const project = {
    id: "p",
    name: "initial",
    root: "/fixture",
    indexing: { extensions: [".ts"], exclude: [], respectGitignore: true },
  };
  const range = {
    start: 0,
    end: 1,
    startLine: 1,
    endLine: 1,
    startColumn: 1,
    endColumn: 2,
  };
  const node = {
    id: "file",
    projectId: "p",
    name: "a.ts",
    qualifiedName: "a.ts",
    path: "a.ts",
    kind: "file",
    range,
    contentHash: "0".repeat(64),
  };
  const diagnostic = {
    path: "a.ts",
    range,
    severity: "error",
    source: "parser",
    code: "syntax",
    message: "original",
  };
  const graph = {
    project,
    nodes: [node],
    edges: [],
    diagnostics: [diagnostic, diagnostic],
  };
  replaceProjectGraph(db, graph);
  const snapshot = () =>
    Object.fromEntries(
      ["projects", "revisions", "nodes", "edges", "diagnostics"].map(
        (table) => [
          table,
          db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ],
      ),
    );
  const before = snapshot();
  db.exec(
    "CREATE TRIGGER reject_diagnostic BEFORE INSERT ON diagnostics WHEN NEW.message = 'reject' BEGIN SELECT RAISE(ABORT, 'late failure'); END",
  );
  const changed = {
    project: { ...project, name: "changed" },
    nodes: [{ ...node, contentHash: "1".repeat(64) }],
    edges: [
      {
        id: "edge",
        projectId: "p",
        kind: "CALLS",
        sourceId: "file",
        targetId: "file",
      },
    ],
    diagnostics: [{ ...diagnostic, message: "reject" }],
  };
  assert.throws(() => applyProjectGraph(db, changed), /late failure/);
  assert.deepEqual(snapshot(), before);
  assert.equal(db.inTransaction, false);
  db.exec("DROP TRIGGER reject_diagnostic");
  assert.equal(
    applyProjectGraph(db, { ...changed, diagnostics: [diagnostic] }),
    2,
  );
  assert.equal(snapshot().nodes[0].revision, 2);
  assert.equal(snapshot().edges[0].revision, 2);
  assert.deepEqual(snapshot().diagnostics, [before.diagnostics[0]]);
  assert.equal(snapshot().projects[0].name, "changed");
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});
