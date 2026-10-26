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
