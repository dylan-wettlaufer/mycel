import assert from "node:assert/strict";
import test from "node:test";
import {
  getCallers,
  getDependencies,
  getNeighborhood,
  getNode,
  getNodeDetails,
  openDatabase,
  replaceProjectGraph,
  searchSymbols,
} from "../dist/index.js";

const project = {
  id: "project:fixture",
  name: "fixture",
  root: "/projects/fixture",
  indexing: { extensions: [".ts"], exclude: [], respectGitignore: true },
};

function node(id, name = id, fields = {}) {
  return {
    id,
    projectId: project.id,
    kind: "function",
    name,
    qualifiedName: name,
    path: `src/${id}.ts`,
    contentHash: "a".repeat(64),
    range: {
      start: 7,
      end: 35,
      startLine: 2,
      startColumn: 3,
      endLine: 4,
      endColumn: 8,
    },
    ...fields,
  };
}

function edge(
  sourceId,
  targetId,
  kind = "CALLS",
  id = `${kind}:${sourceId}:${targetId}`,
) {
  return { id, projectId: project.id, sourceId, targetId, kind };
}

function fixture(t, nodes, edges = []) {
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  replaceProjectGraph(db, { project, nodes, edges, diagnostics: [] });
  const other = { ...project, id: "project:other", root: "/projects/other" };
  replaceProjectGraph(db, {
    project: other,
    nodes: nodes.map((n) => ({
      ...n,
      projectId: other.id,
      contentHash: "b".repeat(64),
    })),
    edges: edges.map((e) => ({ ...e, projectId: other.id })),
    diagnostics: [],
  });
  return db;
}

const ids = (result) => result.nodes.map((n) => n.id);

test("getNode restores all graph fields and scopes duplicate IDs to the project", (t) => {
  const original = node("save", "save", {
    kind: "method",
    qualifiedName: "Store.save",
  });
  const db = fixture(t, [original]);
  assert.deepEqual(getNode(db, project.id, original.id), {
    ...original,
    revision: 1,
  });
  assert.equal(
    getNode(db, "project:other", original.id).contentHash,
    "b".repeat(64),
  );
  assert.equal(getNode(db, project.id, "missing"), undefined);
  assert.equal(getNode(db, "missing-project", original.id), undefined);
});

test("search ranks exact, prefix, and substring matches with stable ties and truncation", (t) => {
  const db = fixture(t, [
    node("substring", "autosave"),
    node("prefix-z", "saveLater"),
    node("prefix-a", "saveAll"),
    node("exact", "SAVE"),
    node("qualified", "write", { qualifiedName: "save.Store.write" }),
    node("path", "worker", { path: "save/worker.ts" }),
    node("file", "save.ts", { kind: "file" }),
  ]);
  const result = searchSymbols(db, project.id, " save ", 20);
  assert.deepEqual(ids(result), [
    "exact",
    "file",
    "prefix-a",
    "prefix-z",
    "path",
    "qualified",
    "substring",
  ]);
  assert.equal(result.projectId, project.id);
  assert.equal(result.revision, 1);
  assert.equal(result.truncated, false);
  assert.ok(result.nodes.every((n) => n.projectId === project.id));
  assert.deepEqual(ids(searchSymbols(db, project.id, "save", 2)), [
    "exact",
    "file",
  ]);
  assert.equal(searchSymbols(db, project.id, "save", 2).truncated, true);
  assert.equal(searchSymbols(db, project.id, "save", 7).truncated, false);
  assert.deepEqual(searchSymbols(db, project.id, "  "), {
    projectId: project.id,
    revision: 1,
    nodes: [],
    truncated: false,
  });
  assert.deepEqual(searchSymbols(db, "missing", "save"), {
    projectId: "missing",
    revision: 0,
    nodes: [],
    truncated: false,
  });
});

test("search treats wildcard characters and SQL syntax as literal text", (t) => {
  const db = fixture(t, [
    node("percent", "save%"),
    node("underscore", "save_"),
    node("slash", "save\\"),
    node("plain", "saveX"),
  ]);
  for (const [query, expected] of [
    ["%", "percent"],
    ["_", "underscore"],
    ["\\", "slash"],
  ]) {
    assert.deepEqual(ids(searchSymbols(db, project.id, query)), [expected]);
  }
  assert.deepEqual(ids(searchSymbols(db, project.id, "' OR 1=1 --")), []);
});

test("neighborhood traverses all edge kinds in both directions and returns the induced subgraph", (t) => {
  const nodes = [node("a"), node("b"), node("c"), node("d"), node("isolated")];
  const edges = [
    edge("a", "b", "CONTAINS"),
    edge("c", "b"),
    edge("c", "d", "IMPORTS"),
    edge("d", "a"),
    edge("b", "b"),
    edge("a", "b", "CALLS"),
    edge("b", "a"),
  ];
  const db = fixture(t, nodes, edges);
  const result = getNeighborhood(db, project.id, "b", 1, 100);
  assert.deepEqual(ids(result), ["b", "a", "c"]);
  assert.deepEqual(
    result.edges,
    edges
      .filter(
        (e) =>
          ["a", "b", "c"].includes(e.sourceId) &&
          ["a", "b", "c"].includes(e.targetId),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({ ...e, revision: 1 })),
  );
  assert.equal(result.projectId, project.id);
  assert.equal(result.revision, 1);
  assert.equal(result.rootId, "b");
  assert.equal(result.truncated, false);
  assert.deepEqual(ids(getNeighborhood(db, project.id, "b", 2)), [
    "b",
    "a",
    "c",
    "d",
  ]);
  assert.deepEqual(ids(getNeighborhood(db, project.id, "b", 100)), [
    "b",
    "a",
    "c",
    "d",
  ]);
  const zero = getNeighborhood(db, project.id, "b", 0, 1);
  assert.deepEqual(ids(zero), ["b"]);
  assert.deepEqual(
    zero.edges.map((e) => e.id),
    ["CALLS:b:b"],
  );
  assert.equal(zero.truncated, false);
  assert.deepEqual(ids(getNeighborhood(db, project.id, "isolated")), [
    "isolated",
  ]);
  assert.equal(getNeighborhood(db, project.id, "missing"), undefined);
  assert.equal(getNeighborhood(db, "missing-project", "b"), undefined);
});

test("neighborhood reports only size truncation and never includes dangling edges", (t) => {
  const db = fixture(
    t,
    [node("a"), node("b"), node("c"), node("d")],
    [edge("a", "b"), edge("b", "c"), edge("a", "d")],
  );
  const capped = getNeighborhood(db, project.id, "a", 2, 2);
  assert.deepEqual(ids(capped), ["a", "b"]);
  assert.equal(capped.truncated, true);
  assert.deepEqual(
    capped.edges.map((e) => e.id),
    ["CALLS:a:b"],
  );
  assert.equal(getNeighborhood(db, project.id, "a", 1, 3).truncated, false);
  assert.equal(getNeighborhood(db, project.id, "a", 2, 3).truncated, true);
  assert.equal(getNeighborhood(db, project.id, "a", 2, 4).truncated, false);
  assert.equal(getNeighborhood(db, project.id, "a", 1, 1).truncated, true);
  assert.equal(getNeighborhood(db, project.id, "a", 0, 1).truncated, false);
});

test("callers are distinct direct incoming CALLS sources, including file nodes", (t) => {
  const db = fixture(
    t,
    [
      node("root"),
      node("a", "Alpha", { kind: "file" }),
      node("b", "Beta"),
      node("c"),
    ],
    [
      edge("a", "root"),
      edge("a", "root", "CALLS", "duplicate-call"),
      edge("b", "root"),
      edge("c", "root", "IMPORTS"),
      edge("root", "c"),
      edge("root", "b", "CONTAINS"),
    ],
  );
  assert.deepEqual(ids(getCallers(db, project.id, "root")), ["a", "b"]);
  assert.equal(getCallers(db, project.id, "root", 2).truncated, false);
  assert.deepEqual(ids(getCallers(db, project.id, "root", 1)), ["a"]);
  assert.equal(getCallers(db, project.id, "root", 1).truncated, true);
  assert.deepEqual(getCallers(db, project.id, "missing"), {
    nodes: [],
    truncated: false,
  });
  assert.deepEqual(getCallers(db, "missing", "root"), {
    nodes: [],
    truncated: false,
  });
});

test("queries validate integer bounds before reading", (t) => {
  const db = fixture(t, []);
  for (const limit of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () => searchSymbols(db, project.id, "save", limit),
      RangeError,
    );
    assert.throws(() => getCallers(db, project.id, "save", limit), RangeError);
    assert.throws(
      () => getNodeDetails(db, project.id, "save", limit),
      RangeError,
    );
    assert.throws(
      () => getDependencies(db, project.id, "save", limit),
      RangeError,
    );
    assert.throws(
      () => getNeighborhood(db, project.id, "save", 1, limit),
      RangeError,
    );
  }
  for (const depth of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => getNeighborhood(db, project.id, "save", depth),
      RangeError,
    );
  }
});

test("dependencies include distinct direct calls and imports, excluding containment and incoming edges", (t) => {
  const db = fixture(
    t,
    [
      node("root"),
      node("a", "Alpha"),
      node("b", "Beta", { kind: "file" }),
      node("c"),
      node("d"),
    ],
    [
      edge("root", "a"),
      edge("root", "a", "CALLS", "duplicate-call"),
      edge("root", "a", "IMPORTS"),
      edge("root", "b", "IMPORTS"),
      edge("root", "c", "CONTAINS"),
      edge("d", "root"),
      edge("b", "d", "IMPORTS"),
    ],
  );
  const result = getDependencies(db, project.id, "root");
  assert.deepEqual(ids(result), ["a", "b"]);
  assert.ok(result.nodes.every((n) => n.projectId === project.id));
  assert.equal(result.truncated, false);
  assert.equal(getDependencies(db, project.id, "root", 2).truncated, false);
  assert.deepEqual(ids(getDependencies(db, project.id, "root", 1)), ["a"]);
  assert.equal(getDependencies(db, project.id, "root", 1).truncated, true);
  assert.deepEqual(getDependencies(db, project.id, "missing"), {
    nodes: [],
    truncated: false,
  });
  assert.deepEqual(getDependencies(db, "missing", "root"), {
    nodes: [],
    truncated: false,
  });
});

test("query context uses the latest project revision, even when nodes retain older revisions", (t) => {
  const db = fixture(t, [node("root")]);
  db.prepare("INSERT INTO revisions (project_id, revision) VALUES (?, ?)").run(
    project.id,
    2,
  );
  const search = searchSymbols(db, project.id, "root");
  const neighborhood = getNeighborhood(db, project.id, "root");
  const details = getNodeDetails(db, project.id, "root");
  assert.equal(search.revision, 2);
  assert.equal(search.nodes[0].revision, 1);
  assert.equal(neighborhood.revision, 2);
  assert.equal(neighborhood.nodes[0].revision, 1);
  assert.equal(details.revision, 2);
  assert.equal(details.node.revision, 1);
  assert.equal(searchSymbols(db, "project:other", "root").revision, 1);

  replaceProjectGraph(db, { project, nodes: [], edges: [], diagnostics: [] });
  assert.deepEqual(searchSymbols(db, project.id, "root"), {
    projectId: project.id,
    revision: 3,
    nodes: [],
    truncated: false,
  });
  assert.equal(getNode(db, project.id, "root"), undefined);
  assert.equal(getNeighborhood(db, project.id, "root"), undefined);
  assert.equal(getNodeDetails(db, project.id, "root"), undefined);
});

test("node details find related files independently of truncated caller lists", (t) => {
  const db = fixture(
    t,
    [
      node("root", "root", { path: "src/root.ts" }),
      node("file:root", "root.ts", { kind: "file", path: "src/root.ts" }),
      node("file:a", "a.ts", { kind: "file", path: "src/a.ts" }),
      node("file:b", "b.ts", { kind: "file", path: "src/b.ts" }),
      node("file:z", "z.ts", { kind: "file", path: "src/z.ts" }),
      node("alpha", "Alpha", { path: "src/z.ts" }),
      node("beta", "Beta", { path: "src/b.ts" }),
      node("zulu", "Zulu", { path: "src/a.ts" }),
    ],
    [edge("alpha", "root"), edge("beta", "root"), edge("zulu", "root")],
  );
  const details = getNodeDetails(db, project.id, "root", 2);
  assert.deepEqual(ids(details.callers), ["alpha", "beta"]);
  assert.equal(details.callers.truncated, true);
  assert.deepEqual(ids(details.relatedFiles), ["file:root", "file:a"]);
  assert.equal(details.relatedFiles.truncated, true);
  assert.deepEqual(details.dependencies, { nodes: [], truncated: false });
  assert.deepEqual(details.diagnostics, []);
  assert.ok(
    details.relatedFiles.nodes.every(
      (n) => n.kind === "file" && n.projectId === project.id,
    ),
  );
  assert.equal(getNodeDetails(db, "missing-project", "root"), undefined);
});

test("default limits bound search, relationship lists, and wide neighborhoods", (t) => {
  const children = Array.from({ length: 105 }, (_, i) =>
    node(`child-${String(i).padStart(3, "0")}`),
  );
  const db = fixture(
    t,
    [node("root"), ...children],
    children.flatMap((n) => [edge("root", n.id), edge(n.id, "root")]),
  );
  assert.equal(searchSymbols(db, project.id, "child").nodes.length, 20);
  assert.equal(searchSymbols(db, project.id, "child").truncated, true);
  for (const query of [getCallers, getDependencies, getNeighborhood]) {
    const result = query(db, project.id, "root");
    assert.equal(result.nodes.length, 100);
    assert.equal(result.truncated, true);
    assert.equal(new Set(ids(result)).size, 100);
    assert.ok(result.nodes.every((n) => n.projectId === project.id));
  }
});
