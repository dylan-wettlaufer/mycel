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
