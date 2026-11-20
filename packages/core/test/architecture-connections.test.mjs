import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@mycel/db";
import {
  assignFilesToParts,
  buildFallbackArchitecture,
  computeArchitectureConnections,
  createGraphQueries,
  extractCrossFileLinks,
  getArchitectureConnections,
  indexRepository,
} from "../dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), "mycel-connections-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(root, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(
      fullPath,
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
  }
  return root;
}

test("computes evidence-backed cross-part connections for Mycel itself", async (t) => {
  const database = openDatabase({ databasePath: ":memory:" });
  t.after(() => database.close());

  const indexed = await indexRepository({
    database,
    project: { name: "mycel", root: repoRoot },
  });
  const fallback = await buildFallbackArchitecture(repoRoot);
  const assignment = assignFilesToParts(fallback, indexed.files);
  const snapshot = getArchitectureConnections(
    database,
    indexed.projectId,
    assignment,
  );

  assert.equal(snapshot.projectId, indexed.projectId);
  assert.equal(snapshot.revision, indexed.revision);

  const byId = new Map(snapshot.connections.map((edge) => [edge.id, edge]));

  // Verify real workspace package connections backed by indexed imports/calls.
  for (const id of [
    "cli->server",
    "server->core",
    "core->parser",
    "core->db",
    "web->shared",
  ]) {
    const connection = byId.get(id);
    assert.ok(connection, `expected connection ${id}`);
    assert.ok(connection.importCount > 0, `expected imports for ${id}`);
    assert.equal(
      connection.count,
      connection.importCount + connection.callCount,
    );
    assert.equal(connection.truncated, false);
    assert.equal(connection.evidence.length, connection.count);
  }

  // No self-loops on any part.
  for (const connection of snapshot.connections) {
    assert.notEqual(connection.sourcePartId, connection.targetPartId);
    for (const item of connection.evidence) {
      assert.equal(assignment.fileToPart[item.file], connection.sourcePartId);
      assert.equal(
        assignment.fileToPart[item.targetFile],
        connection.targetPartId,
      );
      assert.ok(Number.isSafeInteger(item.line) && item.line >= 1);
    }
  }

  // `core->db` includes resolved symbol calls alongside file imports.
  const coreToDb = byId.get("core->db");
  assert.ok(coreToDb.callCount > 0);
  const openDbCall = coreToDb.evidence.find(
    (item) =>
      item.kind === "call" &&
      item.file === "packages/core/src/project.ts" &&
      item.symbol === "openDatabase",
  );
  assert.ok(openDbCall, "expected openIndexedProject -> openDatabase evidence");
  assert.equal(openDbCall.sourceSymbol, "openIndexedProject");
  assert.equal(openDbCall.targetFile, "packages/db/src/database.ts");
  assert.ok(openDbCall.line > 1);

  // GraphQueries exposes the same snapshot via getCrossFileLinks.
  const queries = createGraphQueries(database, indexed.projectId);
  const linksSnapshot = queries.getCrossFileLinks();
  assert.equal(linksSnapshot.revision, indexed.revision);
  assert.deepEqual(
    computeArchitectureConnections(assignment, linksSnapshot.links),
    snapshot.connections,
  );
});

test("combines imports and calls, preserves bidirectional edges, and ignores intra-part links", async (t) => {
  const root = await fixture(t, {
    "package.json": {
      name: "demo",
      workspaces: ["apps/*", "packages/*"],
    },
    "apps/web/package.json": { name: "@demo/web" },
    "apps/web/src/page.ts": [
      "// Route entry point",
      'import { handleRequest } from "@demo/server";',
      'import type { RequestData } from "@demo/server";',
      'import { type ResultData } from "@demo/server";',
      'import { handleRequest as handler, type ResultData as MixedData } from "@demo/server";',
      'import type { ResultData as SameLineData } from "@demo/server"; import { handleRequest as sameLineHandler } from "@demo/server";',
      "export function renderPage() {",
      "  handleRequest();",
      "  return handleRequest();",
      "}",
      "",
    ].join("\n"),
    "packages/server/package.json": {
      name: "@demo/server",
      exports: { ".": "./src/index.ts" },
    },
    "packages/server/src/index.ts": [
      'import { runQuery } from "@demo/core";',
      "export function handleRequest() {",
      "  return runQuery();",
      "}",
      "",
    ].join("\n"),
    "packages/core/package.json": {
      name: "@demo/core",
      exports: { ".": "./src/index.ts" },
    },
    "packages/core/src/helper.ts":
      "export function format() { return 'ok'; }\n",
    "packages/core/src/index.ts": [
      'import { format } from "./helper.js";',
      'import { loadRows } from "@demo/db";',
      "export function runQuery() {",
      "  format();",
      "  return loadRows();",
      "}",
      "export function validateRow() { return true; }",
      "",
    ].join("\n"),
    "packages/db/package.json": {
      name: "@demo/db",
      exports: { ".": "./src/index.ts" },
    },
    "packages/db/src/index.ts": [
      'import { validateRow } from "@demo/core";',
      "export function loadRows() {",
      "  return validateRow();",
      "}",
      "",
    ].join("\n"),
  });

  const database = openDatabase({ databasePath: ":memory:" });
  t.after(() => database.close());

  const indexed = await indexRepository({
    database,
    project: { name: "demo", root },
  });
  const fallback = await buildFallbackArchitecture(root);
  const assignment = assignFilesToParts(fallback, indexed.files);
  const { connections } = getArchitectureConnections(
    database,
    indexed.projectId,
    assignment,
  );

  assert.deepEqual(
    connections.map((edge) => ({
      id: edge.id,
      count: edge.count,
      importCount: edge.importCount,
      callCount: edge.callCount,
    })),
    [
      { id: "core->db", count: 2, importCount: 1, callCount: 1 },
      { id: "db->core", count: 2, importCount: 1, callCount: 1 },
      { id: "server->core", count: 2, importCount: 1, callCount: 1 },
      { id: "web->server", count: 2, importCount: 1, callCount: 1 },
    ],
  );

  const webToServer = connections.find((edge) => edge.id === "web->server");
  assert.deepEqual(webToServer.evidence, [
    {
      kind: "import",
      file: "apps/web/src/page.ts",
      line: 2,
      additionalLines: [3, 4, 5, 6],
      typeOnlyImportLines: [3, 4],
      targetFile: "packages/server/src/index.ts",
    },
    {
      kind: "call",
      file: "apps/web/src/page.ts",
      line: 8,
      additionalLines: [9],
      targetFile: "packages/server/src/index.ts",
      sourceSymbol: "renderPage",
      symbol: "handleRequest",
    },
  ]);
});

test("extracts links from in-memory graphs, deduplicates, caps evidence, and validates limits", () => {
  const range = (line) => ({
    start: 0,
    end: 10,
    startLine: line,
    startColumn: 1,
    endLine: line,
    endColumn: 11,
  });

  const links = extractCrossFileLinks({
    nodes: [
      {
        id: "f1",
        kind: "file",
        path: "a/one.ts",
        qualifiedName: "a/one.ts",
        range: range(1),
      },
      {
        id: "fn1",
        kind: "function",
        path: "a/one.ts",
        qualifiedName: "caller",
        range: range(12),
      },
      {
        id: "f2",
        kind: "file",
        path: "b/two.ts",
        qualifiedName: "b/two.ts",
        range: range(1),
      },
      {
        id: "fn2",
        kind: "function",
        path: "b/two.ts",
        qualifiedName: "calleeA",
        range: range(5),
      },
      {
        id: "fn3",
        kind: "function",
        path: "b/two.ts",
        qualifiedName: "calleeB",
        range: range(9),
      },
    ],
    edges: [
      { kind: "CONTAINS", sourceId: "f1", targetId: "fn1" },
      { kind: "IMPORTS", sourceId: "f1", targetId: "f2" },
      { kind: "CALLS", sourceId: "fn1", targetId: "fn3" },
      { kind: "CALLS", sourceId: "fn1", targetId: "fn2" },
      { kind: "CALLS", sourceId: "fn1", targetId: "fn2" },
      { kind: "CALLS", sourceId: "fn2", targetId: "fn3" }, // intra-file, ignored
    ],
  });

  const assignment = assignFilesToParts(
    {
      version: 1,
      source: "agent",
      parts: [
        {
          id: "a",
          name: "a",
          purpose: "Part a.",
          kind: "library",
          paths: ["a/**"],
        },
        {
          id: "b",
          name: "b",
          purpose: "Part b.",
          kind: "library",
          paths: ["b/**"],
        },
      ],
    },
    ["a/one.ts", "b/two.ts"],
  );

  const capped = computeArchitectureConnections(assignment, links, {
    evidenceLimit: 2,
  });
  assert.equal(capped.length, 1);
  assert.equal(capped[0].count, 3);
  assert.equal(capped[0].importCount, 1);
  assert.equal(capped[0].callCount, 2);
  assert.equal(capped[0].truncated, true);
  assert.deepEqual(capped[0].evidence, [
    {
      kind: "import",
      file: "a/one.ts",
      line: 1,
      targetFile: "b/two.ts",
      approximate: true,
    },
    {
      kind: "call",
      file: "a/one.ts",
      line: 12,
      targetFile: "b/two.ts",
      approximate: true,
      sourceSymbol: "caller",
      symbol: "calleeA",
    },
  ]);

  for (const invalid of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () =>
        computeArchitectureConnections(assignment, links, {
          evidenceLimit: invalid,
        }),
      RangeError,
    );
  }
});

test("scopes cross-file connection queries to the requested project", async (t) => {
  const rootA = await fixture(t, {
    "a/entry.ts": 'import { helper } from "../b/helper.js"; helper();\n',
    "b/helper.ts": "export function helper() {}\n",
  });
  const rootB = await fixture(t, {
    "a/entry.ts": "export const standalone = true;\n",
    "b/helper.ts": "export function helper() {}\n",
  });

  const database = openDatabase({ databasePath: ":memory:" });
  t.after(() => database.close());

  const indexedA = await indexRepository({
    database,
    project: { name: "proj-a", root: rootA },
  });
  const indexedB = await indexRepository({
    database,
    project: { name: "proj-b", root: rootB },
  });

  const architecture = {
    version: 1,
    source: "agent",
    parts: [
      {
        id: "a",
        name: "a",
        purpose: "Part a.",
        kind: "library",
        paths: ["a/**"],
      },
      {
        id: "b",
        name: "b",
        purpose: "Part b.",
        kind: "library",
        paths: ["b/**"],
      },
    ],
  };

  const connA = getArchitectureConnections(
    database,
    indexedA.projectId,
    assignFilesToParts(architecture, indexedA.files),
  );
  const connB = getArchitectureConnections(
    database,
    indexedB.projectId,
    assignFilesToParts(architecture, indexedB.files),
  );

  assert.equal(connA.connections.length, 1);
  assert.equal(connA.connections[0].id, "a->b");
  assert.deepEqual(connB.connections, []);
});
