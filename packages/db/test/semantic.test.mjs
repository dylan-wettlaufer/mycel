import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  openDatabase,
  replaceProjectGraph,
  applyProjectGraph,
  getSemanticGraph,
  getSemanticFeatures,
  getSemanticFeature,
  getSemanticNeighborhood,
  migrateDatabase,
} from "../dist/index.js";
import { migrations } from "../dist/migrations/index.js";

const project = {
  id: "p",
  name: "fixture",
  root: "/fixture",
  indexing: { extensions: [".ts"], exclude: [], respectGitignore: true },
};
const range = {
  start: 0,
  end: 10,
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 11,
};
const provenance = {
  kind: "deterministic",
  extractor: "fixture",
  version: "1",
  rule: "declared",
  confidence: 1,
};
const source = { nodeId: "file", path: "main.ts", range };
const entity = (id) => ({
  id,
  projectId: "p",
  kind: "service_operation",
  name: id,
  attributes: {},
  sources: [source],
  provenance,
});
const relationship = (a, b) => ({
  id: `${a}-${b}`,
  projectId: "p",
  sourceId: a,
  targetId: b,
  kind: "CALLS",
  sources: [source],
  provenance,
});
const graph = (
  semantic = {
    entities: [entity("a"), entity("b"), entity("c")],
    relationships: [relationship("a", "b"), relationship("b", "c")],
  },
) => ({
  project,
  nodes: [
    {
      id: "file",
      projectId: "p",
      kind: "file",
      name: "main.ts",
      qualifiedName: "main.ts",
      path: "main.ts",
      range,
      contentHash: "a".repeat(64),
    },
  ],
  edges: [],
  diagnostics: [],
  semantic,
});
function database(t) {
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  return db;
}

test("migrates an existing structural graph and persists semantic evidence with bounded project-scoped traversal", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  migrateDatabase(db, migrations.slice(0, 2));
  db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?)").run(
    project.id,
    project.name,
    project.root,
    JSON.stringify(project.indexing),
  );
  assert.equal(migrateDatabase(db), migrations.length);
  assert.equal(
    db.prepare("SELECT name FROM projects WHERE id = 'p'").get().name,
    "fixture",
  );
  replaceProjectGraph(db, graph());
  const snapshot = getSemanticGraph(db, "p");
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.entities.length, 3);
  assert.deepEqual(snapshot.entities[0].sources, [source]);
  assert.deepEqual(snapshot.relationships[0].provenance, provenance);
  assert.equal(getSemanticNeighborhood(db, "p", "a", 2).entities.length, 3);
  const bounded = getSemanticNeighborhood(db, "p", "a", 2, 2);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.relationships.length, 1);
  assert.equal(getSemanticNeighborhood(db, "p", "a", 0).entities.length, 1);
  assert.equal(getSemanticNeighborhood(db, "other", "a"), undefined);
  assert.equal(getSemanticGraph(db, "other").entities.length, 0);
  assert.equal(getSemanticGraph(db, "p", 1).truncated, true);
  for (const limit of [0, 501, 1.5])
    assert.throws(() => getSemanticGraph(db, "p", limit), RangeError);
  assert.throws(() => getSemanticNeighborhood(db, "p", "a", 6), RangeError);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("semantic validation failures roll back structural writes and revision allocation", (t) => {
  const db = database(t);
  replaceProjectGraph(db, graph());
  const before = getSemanticGraph(db, "p");
  const invalid = [
    { entities: [{ ...entity("bad"), projectId: "other" }], relationships: [] },
    { entities: [{ ...entity("bad"), sources: [] }], relationships: [] },
    {
      entities: [
        { ...entity("bad"), sources: [{ ...source, nodeId: "missing" }] },
      ],
      relationships: [],
    },
    {
      entities: [
        {
          ...entity("bad"),
          sources: [{ ...source, range: { ...range, end: 11 } }],
        },
      ],
      relationships: [],
    },
    {
      entities: [
        { ...entity("bad"), provenance: { ...provenance, confidence: 2 } },
      ],
      relationships: [],
    },
    { entities: [{ ...entity("bad"), provenance: {} }], relationships: [] },
    { entities: [entity("a")], relationships: [relationship("a", "missing")] },
  ];
  for (const semantic of invalid) {
    assert.throws(() => applyProjectGraph(db, graph(semantic)));
    assert.deepEqual(getSemanticGraph(db, "p"), before);
    assert.equal(
      db.prepare("SELECT MAX(revision) AS n FROM revisions").get().n,
      1,
    );
  }
});

test("replacement removes stale relationships and evidence and cascades project deletion", (t) => {
  const db = database(t);
  replaceProjectGraph(db, graph());
  applyProjectGraph(db, graph({ entities: [entity("a")], relationships: [] }));
  assert.deepEqual(
    getSemanticGraph(db, "p").entities.map((item) => item.id),
    ["a"],
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM semantic_sources").get().n,
    1,
  );
  assert.equal(getSemanticGraph(db, "p").relationships.length, 0);
  db.prepare("DELETE FROM projects WHERE id = 'p'").run();
  for (const table of [
    "semantic_entities",
    "semantic_relationships",
    "semantic_sources",
  ])
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("feature queries filter candidates and declarations and return bounded direct memberships with evidence", (t) => {
  const db = database(t);
  const candidate = {
    ...entity("feature:candidate"),
    kind: "feature",
    name: "orders",
    attributes: { status: "candidate" },
    provenance: { ...provenance, kind: "heuristic", confidence: 0.8 },
  };
  // Legacy declared features did not have a status attribute.
  const declared = {
    ...entity("feature:declared"),
    kind: "feature",
    name: "billing",
  };
  const membership = (member) => ({
    ...relationship(member, candidate.id),
    kind: "IMPLEMENTS",
    provenance: { ...provenance, kind: "heuristic", confidence: 0.65 },
  });
  replaceProjectGraph(
    db,
    graph({
      entities: [
        candidate,
        declared,
        entity("a"),
        entity("b"),
        entity("unrelated"),
      ],
      relationships: [membership("a"), membership("b"), relationship("a", "b")],
    }),
  );
  assert.deepEqual(
    getSemanticFeatures(db, "p").features.map((feature) => feature.name),
    ["billing", "orders"],
  );
  assert.deepEqual(
    getSemanticFeatures(db, "p", { status: "candidate" }).features.map(
      (feature) => feature.id,
    ),
    [candidate.id],
  );
  assert.deepEqual(
    getSemanticFeatures(db, "p", { status: "declared" }).features.map(
      (feature) => feature.id,
    ),
    [declared.id],
  );
  assert.equal(getSemanticFeatures(db, "p", { limit: 1 }).truncated, true);
  assert.equal(getSemanticFeatures(db, "other").features.length, 0);
  const details = getSemanticFeature(db, "p", candidate.id);
  assert.equal(details.entities.length, 3);
  assert.equal(details.relationships.length, 2);
  assert.ok(
    details.relationships.every(
      (edge) =>
        edge.kind === "IMPLEMENTS" && edge.provenance.kind === "heuristic",
    ),
  );
  assert.deepEqual(details.relationships[0].sources, [source]);
  assert.equal(getSemanticFeature(db, "p", candidate.id, 2).truncated, true);
  const root = getSemanticFeature(db, "p", candidate.id, 1);
  assert.equal(root.entities.length, 1);
  assert.equal(root.relationships.length, 0);
  assert.equal(root.truncated, true);
  assert.equal(getSemanticFeature(db, "p", "a"), undefined);
  assert.equal(getSemanticFeature(db, "other", candidate.id), undefined);
  assert.throws(
    () => getSemanticFeatures(db, "p", { status: "verified" }),
    RangeError,
  );
  assert.throws(() => getSemanticFeatures(db, "p", { limit: 501 }), RangeError);
  assert.throws(() => getSemanticFeature(db, "p", candidate.id, 0), RangeError);
});
