import assert from "node:assert/strict";
import test from "node:test";
import {
  openDatabase,
  replaceProjectGraph,
  getBehaviourEntries,
  traceBehaviour,
} from "../dist/index.js";
const range = {
  start: 0,
  end: 10,
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 11,
};
const project = {
  id: "p",
  name: "trace",
  root: "/fixture",
  indexing: { extensions: [".ts"], exclude: [], respectGitignore: true },
};
const provenance = {
  kind: "deterministic",
  extractor: "behaviour-bindings",
  version: "1",
  rule: "lexical-call",
  confidence: 1,
};
const source = { nodeId: "file", path: "main.ts", range };
const entity = (id, role = "callable", attributes = {}) => ({
  id,
  projectId: "p",
  kind: "service_operation",
  name: id,
  attributes: { traceRole: role, ...attributes },
  sources: [source],
  provenance,
});
const edge = (from, to, kind = "CALLS", prov = provenance) => ({
  id: `${from}:${to}:${kind}:${prov.extractor}`,
  projectId: "p",
  sourceId: from,
  targetId: to,
  kind,
  provenance: prov,
  sources: [source],
});
function snapshot() {
  return {
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
      {
        id: "node:service",
        projectId: "p",
        kind: "function",
        name: "service",
        qualifiedName: "service",
        path: "main.ts",
        range,
        contentHash: "a".repeat(64),
      },
    ],
    edges: [],
    diagnostics: [],
    semantic: {
      entities: [
        entity("component"),
        entity("event", "ui_event"),
        entity("submit"),
        entity("request", "http_request"),
        { ...entity("endpoint"), kind: "endpoint" },
        entity("handler"),
        {
          ...entity("service"),
          sources: [{ ...source, nodeId: "node:service" }],
        },
        entity("read", "prisma_operation"),
        entity("write", "prisma_operation"),
        {
          ...entity("model"),
          kind: "data_model",
          attributes: { provider: "prisma" },
        },
        entity("unknown", "unresolved", {
          code: "dynamic-url",
          message: "URL is unknown",
        }),
        entity("fake"),
      ],
      relationships: [
        edge("component", "event"),
        edge("event", "submit"),
        edge("submit", "request"),
        edge("request", "endpoint"),
        edge("handler", "endpoint", "HANDLES", {
          ...provenance,
          extractor: "next-app-router",
          rule: "http-method-export",
        }),
        edge("handler", "service"),
        edge("service", "read"),
        edge("service", "write"),
        edge("read", "model", "READS"),
        edge("write", "model", "WRITES"),
        edge("submit", "unknown"),
        edge("service", "fake", "CALLS", {
          ...provenance,
          extractor: "typescript-references",
        }),
        edge("service", "fake", "CALLS", {
          ...provenance,
          kind: "heuristic",
          extractor: "feature-discovery",
        }),
      ],
    },
  };
}
function database(t) {
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  return db;
}

test("forward/reverse traces return alternative evidence paths, handle endpoint orientation, and exclude heuristic/legacy hints", (t) => {
  const db = database(t);
  replaceProjectGraph(db, snapshot());
  const entries = getBehaviourEntries(db, "p");
  assert.equal(entries.entries[0].id, "event");
  const trace = traceBehaviour(db, "p", "event");
  assert.equal(trace.truncated, false);
  assert.equal(trace.paths.length, 3);
  assert.equal(
    trace.paths.filter((path) => path.end === "data-access").length,
    2,
  );
  assert.equal(
    trace.paths.find((path) => path.end === "unresolved").boundary.code,
    "dynamic-url",
  );
  assert.ok(!trace.entities.some((item) => item.id === "fake"));
  const handles = trace.paths
    .flatMap((path) => path.hops)
    .find((hop) => hop.relationship.kind === "HANDLES");
  assert.equal(handles.fromId, "endpoint");
  assert.equal(handles.toId, "handler");
  assert.equal(handles.relationship.sourceId, "handler");
  for (const path of trace.paths) {
    assert.equal(path.entityIds.length, path.hops.length + 1);
    for (const hop of path.hops) {
      assert.deepEqual(hop.relationship.sources, [source]);
      assert.equal(hop.relationship.provenance.kind, "deterministic");
    }
  }
  const reverse = traceBehaviour(db, "p", "node:service", {
    direction: "reverse",
  });
  assert.equal(reverse.rootId, "service");
  assert.equal(reverse.paths.length, 1);
  assert.deepEqual(reverse.paths[0].entityIds, [
    "service",
    "handler",
    "endpoint",
    "request",
    "submit",
    "event",
    "component",
  ]);
  assert.equal(reverse.paths[0].end, "no-supported-callers");
  const boundaryCallers = traceBehaviour(db, "p", "unknown", {
    direction: "reverse",
  });
  assert.ok(
    boundaryCallers.paths.some((path) => path.entityIds.includes("event")),
  );
  assert.equal(traceBehaviour(db, "other", "event"), undefined);
  assert.equal(getBehaviourEntries(db, "other").entries.length, 0);
});

test("trace limits, cycles, source invalidation, and a wide work frontier are explicitly bounded", (t) => {
  const db = database(t);
  const graph = snapshot();
  graph.semantic.relationships.push(edge("service", "service"));
  replaceProjectGraph(db, graph);
  const cycle = traceBehaviour(db, "p", "service");
  assert.ok(cycle.paths.some((path) => path.end === "cycle"));
  assert.equal(cycle.truncated, true);
  assert.equal(
    traceBehaviour(db, "p", "event", { maxDepth: 0 }).paths[0].end,
    "depth-limit",
  );
  const limited = traceBehaviour(db, "p", "event", { maxPaths: 1 });
  assert.equal(limited.paths.length, 1);
  assert.equal(limited.truncated, true);
  const wide = snapshot();
  const leaves = Array.from({ length: 1005 }, (_, index) =>
    entity(`leaf:${index}`),
  );
  wide.semantic.entities.push(...leaves);
  wide.semantic.relationships = leaves.flatMap((leaf) => [
    edge("component", leaf.id),
    edge(leaf.id, "submit"),
  ]);
  replaceProjectGraph(db, wide);
  const bounded = traceBehaviour(db, "p", "component", {
    maxPaths: 100,
    maxDepth: 32,
  });
  assert.equal(bounded.paths.length, 100);
  assert.ok(bounded.paths.every((path) => path.end === "work-limit"));
  assert.ok(bounded.entities.length <= 101);
  assert.equal(bounded.truncated, true);
  replaceProjectGraph(db, {
    ...wide,
    semantic: { entities: [], relationships: [] },
  });
  assert.equal(traceBehaviour(db, "p", "component"), undefined);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("trace query validation rejects invalid bounds and directions before reading", (t) => {
  const db = database(t);
  for (const options of [
    { maxDepth: -1 },
    { maxDepth: 33 },
    { maxDepth: 1.5 },
    { maxPaths: 0 },
    { maxPaths: 101 },
    { direction: "both" },
  ])
    assert.throws(
      () => traceBehaviour(db, "p", "missing", options),
      RangeError,
    );
  assert.throws(() => getBehaviourEntries(db, "p", 501), RangeError);
});
