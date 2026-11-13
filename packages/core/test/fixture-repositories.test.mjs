import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "@mycel/db";
import { parseFile } from "@mycel/parser";
import { createGraphQueries, indexRepository } from "../dist/index.js";

async function sources() {
  return Object.fromEntries(
    await Promise.all(
      ["main.ts", "utils.ts"].map(async (path) => [
        path,
        await readFile(
          new URL(`fixtures/import-call/${path}.txt`, import.meta.url),
          "utf8",
        ),
      ]),
    ),
  );
}

async function indexFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "mycel-import-call-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = await sources();
  await Promise.all(
    Object.entries(files).map(([path, source]) =>
      writeFile(join(root, path), source),
    ),
  );
  const database = openDatabase({ databasePath: ":memory:" });
  t.after(() => database.close());
  const result = await indexRepository({
    project: { name: "import-call", root },
    database,
  });
  const graph = createGraphQueries(database, result.projectId);
  return { database, result, graph };
}

function relationships(database, projectId, kind) {
  return database
    .prepare(
      `
    SELECT source.qualified_name AS source, target.qualified_name AS target
    FROM edges e
    JOIN nodes source ON source.project_id = e.project_id AND source.id = e.source_id
    JOIN nodes target ON target.project_id = e.project_id AND target.id = e.target_id
    WHERE e.project_id = ? AND e.kind = ?
    ORDER BY source.qualified_name, target.qualified_name
  `,
    )
    .all(projectId, kind);
}

function findSymbol(graph, name) {
  const symbol = graph
    .searchSymbols({ q: name })
    .nodes.find((node) => node.kind === "function" && node.name === name);
  assert.ok(symbol, `Missing indexed function: ${name}`);
  return symbol;
}

test("fixture extraction finds declarations, exports, the relative import, and the call's caller and ranges", async () => {
  const files = await sources();
  const main = parseFile("main.ts", files["main.ts"]);
  const utils = parseFile("utils.ts", files["utils.ts"]);
  for (const parsed of [main, utils]) {
    assert.equal(parsed.status, "parsed");
    assert.deepEqual(parsed.diagnostics, []);
  }
  assert.deepEqual(
    main.symbols.map((symbol) => [symbol.kind, symbol.qualifiedName]),
    [["function", "save"]],
  );
  assert.deepEqual(
    utils.symbols.map((symbol) => [symbol.kind, symbol.qualifiedName]),
    [["function", "validate"]],
  );
  const save = main.symbols[0];
  const validate = utils.symbols[0];
  assert.equal(
    files["main.ts"].slice(save.range.start, save.range.end),
    "function save() {\n  validate();\n}",
  );
  assert.equal(
    files["utils.ts"].slice(validate.range.start, validate.range.end),
    "function validate() {}",
  );
  assert.equal(save.range.startLine, 3);
  assert.equal(save.range.endLine, 5);
  assert.deepEqual(
    main.imports.map(({ specifier, bindings, typeOnly }) => ({
      specifier,
      bindings,
      typeOnly,
    })),
    [
      {
        specifier: "./utils",
        bindings: [
          {
            kind: "named",
            imported: "validate",
            local: "validate",
            typeOnly: false,
          },
        ],
        typeOnly: false,
      },
    ],
  );
  assert.deepEqual(
    main.exports.map(({ name, localName }) => [name, localName]),
    [["save", "save"]],
  );
  assert.deepEqual(
    utils.exports.map(({ name, localName }) => [name, localName]),
    [["validate", "validate"]],
  );
  assert.equal(main.calls.length, 1);
  const call = main.calls[0];
  assert.equal(call.callee, "validate");
  assert.equal(call.callerId, save.id);
  assert.equal(call.range.startLine, 4);
  assert.equal(call.range.startColumn, 3);
  assert.equal(
    files["main.ts"].slice(call.range.start, call.range.end),
    "validate()",
  );
  assert.equal(
    files["main.ts"].slice(call.calleeRange.start, call.calleeRange.end),
    "validate",
  );
});

test("fixture indexing persists the two files, two functions, and correct containment without seeded edges", async (t) => {
  const { database, result, graph } = await indexFixture(t);
  assert.deepEqual(result.files, ["main.ts", "utils.ts"]);
  assert.equal(result.fileCount, 2);
  assert.equal(result.symbolCount, 2);
  assert.equal(result.diagnosticCount, 0);
  assert.equal(findSymbol(graph, "save").path, "main.ts");
  assert.equal(findSymbol(graph, "validate").path, "utils.ts");
  assert.deepEqual(relationships(database, result.projectId, "CONTAINS"), [
    { source: "main.ts", target: "save" },
    { source: "utils.ts", target: "validate" },
  ]);
});

test("fixture resolution connects main.ts to utils.ts with an IMPORTS edge", async (t) => {
  const { database, result, graph } = await indexFixture(t);
  assert.deepEqual(relationships(database, result.projectId, "IMPORTS"), [
    { source: "main.ts", target: "utils.ts" },
  ]);
  const file = graph
    .searchSymbols({ q: "main.ts" })
    .nodes.find((node) => node.kind === "file");
  assert.ok(file);
  assert.deepEqual(
    graph.getNodeDetails(file.id).dependencies.nodes.map((node) => node.path),
    ["utils.ts"],
  );
});

test("fixture resolution connects save to imported validate with a CALLS edge", async (t) => {
  const { database, result, graph } = await indexFixture(t);
  assert.deepEqual(relationships(database, result.projectId, "CALLS"), [
    { source: "save", target: "validate" },
  ]);
  const save = findSymbol(graph, "save");
  const validate = findSymbol(graph, "validate");
  assert.deepEqual(
    graph.getNodeDetails(save.id).dependencies.nodes.map((node) => node.id),
    [validate.id],
  );
  assert.deepEqual(
    graph.getNodeDetails(validate.id).callers.nodes.map((node) => node.id),
    [save.id],
  );
});
