import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createGraphQueries } from "@mycel/core";
import { openDatabase, replaceProjectGraph } from "@mycel/db";
import { createApp, startServer } from "../dist/index.js";

const project = {
  id: "project:fixture",
  name: "fixture",
  root: "/projects/fixture",
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
const node = (id, name, kind = "function", path = "src/save.ts") => ({
  id,
  projectId: project.id,
  name,
  qualifiedName: name,
  kind,
  path,
  range,
  contentHash: "a".repeat(64),
});
const edge = (sourceId, targetId, kind) => ({
  id: `${kind}:${sourceId}:${targetId}`,
  projectId: project.id,
  sourceId,
  targetId,
  kind,
});
const nodes = [
  node("file:save", "save.ts", "file"),
  node("node:save", "save"),
  node("node:saveLater", "saveLater"),
  node("node:autosave", "autosave"),
  node("file:caller", "caller.ts", "file", "src/caller.ts"),
  node("node:caller", "caller", "function", "src/caller.ts"),
  node("node:caller2", "caller2", "function", "src/caller.ts"),
  node("file:validate", "validate.ts", "file", "src/validate.ts"),
  node("node:validate", "validate", "function", "src/validate.ts"),
  node("node:validate2", "validate2", "function", "src/validate.ts"),
];
const edges = [
  edge("file:save", "node:save", "CONTAINS"),
  edge("node:caller", "node:save", "CALLS"),
  edge("node:caller2", "node:save", "CALLS"),
  edge("node:save", "node:validate", "CALLS"),
  edge("node:save", "node:validate2", "CALLS"),
  edge("file:save", "file:validate", "IMPORTS"),
];
const diagnostic = {
  path: "src/save.ts",
  range,
  severity: "warning",
  source: "resolver",
  code: "unresolved-call",
  message: "Could not resolve a call",
};

function fixture(t) {
  const database = openDatabase({ databasePath: ":memory:" });
  t.after(() => {
    if (database.open) database.close();
  });
  replaceProjectGraph(database, {
    project,
    nodes,
    edges,
    diagnostics: [diagnostic],
  });
  replaceProjectGraph(database, {
    project: { ...project, id: "project:other", root: "/projects/other" },
    nodes: [...nodes, node("node:secret", "secret")].map((n) => ({
      ...n,
      projectId: "project:other",
      contentHash: "b".repeat(64),
    })),
    edges: edges.map((e) => ({ ...e, projectId: "project:other" })),
    diagnostics: [{ ...diagnostic, message: "other project diagnostic" }],
  });
  const graph = createGraphQueries(database, project.id);
  return { database, graph, app: createApp({ project, graph }) };
}
const ids = (list) => list.nodes.map((n) => n.id);

test("search exposes ranked, bounded results for the selected project", async (t) => {
  const { app } = fixture(t);
  const response = await app.request(
    "/api/graph/search?q=%20SAVE%20&limit=2&projectId=project:other",
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const result = await response.json();
  assert.equal(result.projectId, project.id);
  assert.equal(result.revision, 1);
  assert.deepEqual(ids(result), ["node:save", "file:save"]);
  assert.equal(result.truncated, true);
  assert.ok(result.nodes.every((n) => n.projectId === project.id));
  const empty = await app.request("/api/graph/search?q=does-not-exist");
  assert.deepEqual(await empty.json(), {
    projectId: project.id,
    revision: 1,
    nodes: [],
    truncated: false,
  });
});

test("node details include metadata, independent bounded relationships, related files, and diagnostics", async (t) => {
  const { app } = fixture(t);
  const response = await app.request("/api/graph/nodes/node%3Asave?limit=1");
  assert.equal(response.status, 200);
  const details = await response.json();
  assert.equal(details.projectId, project.id);
  assert.equal(details.revision, 1);
  assert.deepEqual(details.node, { ...nodes[1], revision: 1 });
  assert.deepEqual(ids(details.callers), ["node:caller"]);
  assert.equal(details.callers.truncated, true);
  assert.deepEqual(ids(details.dependencies), ["node:validate"]);
  assert.equal(details.dependencies.truncated, true);
  assert.deepEqual(ids(details.relatedFiles), ["file:save"]);
  assert.equal(details.relatedFiles.truncated, true);
  assert.deepEqual(details.diagnostics, [diagnostic]);

  const full = await (await app.request("/api/graph/nodes/node:save")).json();
  assert.deepEqual(ids(full.relatedFiles), [
    "file:save",
    "file:caller",
    "file:validate",
  ]);
  assert.equal(full.callers.truncated, false);
  assert.equal(full.dependencies.truncated, false);
  assert.equal(full.relatedFiles.truncated, false);
  const file = await (await app.request("/api/graph/nodes/file:save")).json();
  assert.deepEqual(ids(file.dependencies), ["file:validate"]);
});

test("neighborhood bounds depth and size and preserves complete edge endpoints", async (t) => {
  const { app } = fixture(t);
  const response = await app.request(
    "/api/graph/nodes/node%3Asave/neighborhood?depth=1&limit=2",
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.rootId, "node:save");
  assert.equal(result.projectId, project.id);
  assert.equal(result.revision, 1);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.truncated, true);
  const included = new Set(ids(result));
  assert.ok(
    result.edges.every(
      (e) =>
        included.has(e.sourceId) &&
        included.has(e.targetId) &&
        e.projectId === project.id,
    ),
  );
  const rootOnly = await (
    await app.request("/api/graph/nodes/node:save/neighborhood?depth=0&limit=1")
  ).json();
  assert.deepEqual(ids(rootOnly), ["node:save"]);
  assert.equal(rootOnly.truncated, false);
});

test("missing and other-project nodes return JSON 404s, including browser requests", async (t) => {
  const { app } = fixture(t);
  for (const id of ["missing", "node:secret"]) {
    for (const suffix of ["", "/neighborhood"]) {
      const response = await app.request(`/api/graph/nodes/${id}${suffix}`, {
        headers: { accept: "text/html" },
      });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Node not found" });
    }
  }
});

test("graph parameters reject malformed, repeated, and out-of-range input", async (t) => {
  const { app } = fixture(t);
  const invalid = [
    "/search",
    "/search?q=",
    "/search?q=%20%20",
    "/search?q=a&q=b",
    `/search?q=${"a".repeat(1001)}`,
    ...[
      "",
      "0",
      "-1",
      "1.5",
      "1e2",
      "0x10",
      "NaN",
      "Infinity",
      "%201",
      "101",
      "9007199254740992",
      "1&limit=2",
    ].flatMap((value) => [
      `/search?q=save&limit=${value}`,
      `/nodes/node:save?limit=${value}`,
    ]),
    ...["", "-1", "1.5", "6", "1&depth=2"].map(
      (value) => `/nodes/node:save/neighborhood?depth=${value}`,
    ),
    ...["", "0", "-1", "1.5", "501", "1&limit=2"].map(
      (value) => `/nodes/node:save/neighborhood?limit=${value}`,
    ),
  ];
  for (const path of invalid) {
    const response = await app.request(`/api/graph${path}`);
    assert.equal(response.status, 400, path);
    assert.equal(typeof (await response.json()).error, "string", path);
  }
});

test("defaults and upper bounds reach core as validated numeric options", async () => {
  const calls = [];
  const graph = {
    searchSymbols: (query) => {
      calls.push(["search", query]);
      return {
        nodes: [],
        truncated: false,
        projectId: project.id,
        revision: 0,
      };
    },
    getNodeDetails: (id, query) => {
      calls.push(["details", id, query]);
      return undefined;
    },
    getNeighborhood: (id, query) => {
      calls.push(["neighborhood", id, query]);
      return undefined;
    },
  };
  const app = createApp({ graph });
  for (const path of [
    "/search?q=save",
    "/search?q=save&limit=100",
    "/nodes/node:save",
    "/nodes/node:save/neighborhood",
    "/nodes/node:save/neighborhood?depth=5&limit=500",
  ]) {
    await app.request(`/api/graph${path}`);
  }
  assert.deepEqual(calls, [
    ["search", { q: "save", limit: 20 }],
    ["search", { q: "save", limit: 100 }],
    ["details", "node:save", { limit: 100 }],
    ["neighborhood", "node:save", { depth: 1, limit: 100 }],
    ["neighborhood", "node:save", { depth: 5, limit: 500 }],
  ]);
});

test("unconfigured graph queries return JSON 503 while liveness stays available", async () => {
  const app = createApp({ project });
  for (const path of [
    "/search?q=save",
    "/nodes/node:save",
    "/nodes/node:save/neighborhood",
  ]) {
    const response = await app.request(`/api/graph${path}`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Graph queries unavailable",
    });
  }
  assert.equal((await app.request("/api/health")).status, 200);
});

test("unexpected query failures return JSON 500 without leaking database details", async (t) => {
  const { app, database } = fixture(t);
  t.mock.method(console, "error", () => {});
  database.close();
  for (const path of [
    "/search?q=save",
    "/nodes/node:save",
    "/nodes/node:save/neighborhood",
  ]) {
    const response = await app.request(`/api/graph${path}`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Graph query failed" });
  }
});

test("graph queries are served over loopback HTTP alongside the existing API", async (t) => {
  const { graph } = fixture(t);
  const server = startServer(0, { project, graph });
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const search = await fetch(`${base}/api/graph/search?q=save&limit=1`);
  assert.equal(search.status, 200);
  assert.deepEqual(ids(await search.json()), ["node:save"]);
  const details = await fetch(`${base}/api/graph/nodes/node%3Asave`);
  assert.equal((await details.json()).node.id, "node:save");
});

test("source route serves committed captures and rejects paths outside the indexed project", async (t) => {
  const { app, database } = fixture(t);
  database
    .prepare(
      "INSERT INTO snapshots (project_id, path, revision, content) VALUES (?, ?, ?, ?)",
    )
    .run(project.id, "src/save.ts", 1, "export function save() {}\n");
  const response = await app.request("/api/files/content?path=src%2Fsave.ts");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: project.id,
    revision: 1,
    path: "src/save.ts",
    language: "typescript",
    content: "export function save() {}\n",
    contentHash: "a".repeat(64),
  });
  for (const path of [
    "../secret.ts",
    "/etc/passwd",
    "src/../secret.ts",
    "src\\save.ts",
    "",
    "src//save.ts",
  ]) {
    assert.equal(
      (await app.request(`/api/files/content?path=${encodeURIComponent(path)}`))
        .status,
      400,
    );
  }
  assert.equal(
    (await app.request("/api/files/content?path=src/save.ts&path=x.ts")).status,
    400,
  );
  assert.equal(
    (await app.request("/api/files/content?path=missing.ts")).status,
    404,
  );
  assert.equal(
    (await createApp().request("/api/files/content?path=a.ts")).status,
    503,
  );
});

test("statistics count only the selected project's committed graph", async (t) => {
  const { app } = fixture(t);
  const response = await app.request("/api/graph/stats");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: project.id,
    revision: 1,
    fileCount: 3,
    symbolCount: 7,
    edgeCount: 6,
    diagnosticCount: 1,
  });
});

test("repository overview includes all files beyond neighborhood limits with project-scoped import edges", async (t) => {
  const { app, database } = fixture(t);
  const files = Array.from({ length: 130 }, (_, i) =>
    node(`file:${i}`, `${i}.ts`, "file", `area/${i}.ts`),
  );
  replaceProjectGraph(database, {
    project,
    nodes: [...files, node("symbol", "symbol")],
    edges: [
      edge(files[0].id, files[1].id, "IMPORTS"),
      edge(files[0].id, "symbol", "CONTAINS"),
    ],
    diagnostics: [],
  });
  const response = await app.request("/api/graph/repository");
  assert.equal(response.status, 200);
  const graph = await response.json();
  assert.equal(graph.projectId, project.id);
  assert.equal(graph.revision, 2);
  assert.equal(graph.files.length, 130);
  assert.ok(
    graph.files.every(
      (file) => file.kind === "file" && file.projectId === project.id,
    ),
  );
  assert.equal(graph.dependencies.length, 1);
  assert.equal(graph.dependencies[0].kind, "IMPORTS");
  assert.equal(
    (await createApp().request("/api/graph/repository")).status,
    503,
  );
});

test("file drill-down returns every declaration in the file including nested methods", async (t) => {
  const { app, database } = fixture(t);
  replaceProjectGraph(database, {
    project,
    nodes: [
      node("file", "nested.ts", "file", "nested.ts"),
      node("class", "Store", "class", "nested.ts"),
      node("method", "save", "method", "nested.ts"),
      node("other", "elsewhere", "function", "other.ts"),
    ],
    edges: [],
    diagnostics: [],
  });
  const response = await app.request("/api/graph/nodes/file/symbols");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(
    result.nodes.map((node) => node.id),
    ["class", "method"],
  );
  assert.equal(result.truncated, false);
  for (const id of ["class", "missing", "node:secret"])
    assert.equal(
      (await app.request(`/api/graph/nodes/${id}/symbols`)).status,
      404,
    );
});

test("semantic routes validate bounds, preserve project scope, and report missing entities", async (t) => {
  const { app, database } = fixture(t);
  const provenance = {
    kind: "deterministic",
    extractor: "fixture",
    version: "1",
    rule: "explicit",
    confidence: 1,
  };
  replaceProjectGraph(database, {
    project,
    nodes,
    edges,
    diagnostics: [],
    semantic: {
      entities: [
        {
          id: "semantic:save",
          projectId: project.id,
          kind: "service_operation",
          name: "save",
          attributes: {},
          provenance,
          sources: [{ nodeId: "node:save", path: "src/save.ts", range }],
        },
      ],
      relationships: [],
    },
  });
  const response = await app.request(
    "/api/graph/semantic?projectId=project:other",
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.projectId, project.id);
  assert.equal(result.entities.length, 1);
  assert.equal(result.entities[0].sources[0].nodeId, "node:save");
  const neighborhood = await app.request(
    "/api/graph/semantic/semantic%3Asave/neighborhood?depth=0",
  );
  assert.equal(neighborhood.status, 200);
  assert.equal((await neighborhood.json()).entities[0].id, "semantic:save");
  assert.equal(
    (await app.request("/api/graph/semantic/missing/neighborhood")).status,
    404,
  );
  for (const path of [
    "semantic?limit=0",
    "semantic?limit=501",
    "semantic?limit=1&limit=2",
    "semantic/x/neighborhood?depth=6",
    "semantic/x/neighborhood?depth=-1",
  ])
    assert.equal((await app.request(`/api/graph/${path}`)).status, 400);
  assert.equal((await createApp().request("/api/graph/semantic")).status, 503);
});

test("feature routes retrieve candidate memberships and validate status and size bounds", async (t) => {
  const { app, database } = fixture(t);
  const provenance = {
    kind: "heuristic",
    extractor: "fixture-discovery",
    version: "1",
    rule: "route-area",
    confidence: 0.8,
  };
  const sources = [{ nodeId: "node:save", path: "src/save.ts", range }];
  const feature = {
    id: "feature:orders",
    projectId: project.id,
    kind: "feature",
    name: "orders",
    attributes: { status: "candidate" },
    provenance,
    sources,
  };
  const member = {
    ...feature,
    id: "operation:save",
    kind: "service_operation",
    name: "save",
    attributes: {},
  };
  replaceProjectGraph(database, {
    project,
    nodes,
    edges,
    diagnostics: [],
    semantic: {
      entities: [feature, member],
      relationships: [
        {
          id: "membership",
          projectId: project.id,
          sourceId: member.id,
          targetId: feature.id,
          kind: "IMPLEMENTS",
          provenance,
          sources,
        },
      ],
    },
  });
  const response = await app.request(
    "/api/graph/semantic/features?status=candidate&projectId=project:other",
  );
  assert.equal(response.status, 200);
  const list = await response.json();
  assert.equal(list.projectId, project.id);
  assert.equal(list.features[0].id, feature.id);
  assert.equal(list.features[0].provenance.kind, "heuristic");
  assert.equal(
    (
      await (
        await app.request("/api/graph/semantic/features?status=declared")
      ).json()
    ).features.length,
    0,
  );
  const detail = await app.request(
    "/api/graph/semantic/features/feature%3Aorders",
  );
  assert.equal(detail.status, 200);
  const result = await detail.json();
  assert.equal(result.entities.length, 2);
  assert.equal(result.relationships[0].sources[0].nodeId, "node:save");
  assert.equal(
    (await app.request("/api/graph/semantic/features/missing")).status,
    404,
  );
  assert.equal(
    (await app.request("/api/graph/semantic/features/operation%3Asave")).status,
    404,
  );
  for (const path of [
    "features?status=verified",
    "features?status=",
    "features?status=candidate&status=declared",
    "features?limit=501",
    "features/feature%3Aorders?limit=0",
    "features?limit=1&limit=2",
  ])
    assert.equal(
      (await app.request(`/api/graph/semantic/${path}`)).status,
      400,
    );
  assert.equal(
    (await createApp().request("/api/graph/semantic/features")).status,
    503,
  );
  assert.equal(
    (await createApp().request("/api/graph/semantic/features/any")).status,
    503,
  );
});

test("behaviour routes expose entries, evidence paths, reverse function selection, and bounded parameters", async (t) => {
  const { app, database } = fixture(t);
  const provenance = {
    kind: "deterministic",
    extractor: "behaviour-bindings",
    version: "1",
    rule: "event-handler-binding",
    confidence: 1,
  };
  const source = { nodeId: "node:save", path: "src/save.ts", range };
  const operation = {
    id: "operation:save",
    projectId: project.id,
    kind: "service_operation",
    name: "save",
    attributes: { traceRole: "callable" },
    provenance,
    sources: [source],
  };
  const entry = {
    ...operation,
    id: "event:submit",
    name: "form.onSubmit",
    attributes: { traceRole: "ui_event", event: "onSubmit" },
    sources: [{ ...source, nodeId: "file:save" }],
  };
  replaceProjectGraph(database, {
    project,
    nodes,
    edges,
    diagnostics: [],
    semantic: {
      entities: [operation, entry],
      relationships: [
        {
          id: "event:call",
          projectId: project.id,
          sourceId: entry.id,
          targetId: operation.id,
          kind: "CALLS",
          provenance,
          sources: [source],
        },
      ],
    },
  });
  const entries = await app.request(
    "/api/graph/behaviour/entries?projectId=project:other",
  );
  assert.equal(entries.status, 200);
  const list = await entries.json();
  assert.equal(list.projectId, project.id);
  assert.equal(list.entries[0].id, entry.id);
  const response = await app.request("/api/graph/behaviour/event%3Asubmit");
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).paths[0].hops[0].relationship.sources[0].nodeId,
    "node:save",
  );
  const reverse = await app.request(
    "/api/graph/behaviour/node%3Asave?direction=reverse",
  );
  assert.equal(reverse.status, 200);
  assert.equal((await reverse.json()).paths[0].entityIds.at(-1), entry.id);
  for (const query of [
    "direction=both",
    "direction=",
    "direction=reverse&direction=forward",
    "maxDepth=33",
    "maxDepth=-1",
    "maxPaths=0",
    "maxPaths=101",
    "maxPaths=1&maxPaths=2",
  ])
    assert.equal(
      (await app.request(`/api/graph/behaviour/event%3Asubmit?${query}`))
        .status,
      400,
    );
  assert.equal(
    (await app.request("/api/graph/behaviour/entries?limit=501")).status,
    400,
  );
  assert.equal((await app.request("/api/graph/behaviour/missing")).status, 404);
  assert.equal(
    (await createApp().request("/api/graph/behaviour/entries")).status,
    503,
  );
  assert.equal(
    (await createApp().request("/api/graph/behaviour/any")).status,
    503,
  );
});
