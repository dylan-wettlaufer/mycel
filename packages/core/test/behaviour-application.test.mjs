import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "@mycel/db";
import { createGraphQueries, indexRepository } from "../dist/index.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "mycel-behaviour-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sources = new Map();
  const directory = new URL("fixtures/behaviour/", import.meta.url);
  for (const name of await readdir(directory, { recursive: true })) {
    if (
      !name.endsWith(".txt") ||
      name === "Form.tsx.txt" ||
      name === "client.ts.txt"
    )
      continue;
    const path = name.slice(0, -4);
    const source = await readFile(new URL(name, directory), "utf8");
    sources.set(path, source);
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), source);
  }
  const database = openDatabase({ databasePath: ":memory:" });
  t.after(() => database.close());
  return { root, sources, database, project: { name: "orders", root } };
}

test("literal native requests bind same-app Next handlers and verified Prisma CRUD access with source evidence", async (t) => {
  const input = await fixture(t);
  const result = await indexRepository(input);
  const queries = createGraphQueries(input.database, result.projectId);
  const graph = queries.getSemanticGraph(500);
  const requests = graph.entities.filter(
    (entity) => entity.attributes.traceRole === "http_request",
  );
  assert.equal(requests.length, 2);
  assert.equal(
    graph.relationships.filter(
      (edge) => edge.provenance.rule === "literal-http-endpoint",
    ).length,
    2,
  );
  const accesses = graph.relationships.filter((edge) =>
    ["READS", "WRITES"].includes(edge.kind),
  );
  assert.equal(accesses.length, 5);
  assert.equal(accesses.filter((edge) => edge.kind === "READS").length, 2);
  const model = graph.entities.find(
    (entity) =>
      entity.kind === "data_model" && entity.attributes.provider === "prisma",
  );
  assert.equal(model.name, "Order");
  const location = JSON.parse(model.attributes.schemaLocation);
  assert.equal(
    input.sources
      .get(location.path)
      .slice(location.range.start, location.range.end),
    model.attributes.schemaDeclaration,
  );
  for (const access of accesses) {
    assert.equal(access.provenance.kind, "deterministic");
    assert.ok(access.sources.some((source) => source.path === "db/client.ts"));
    assert.ok(
      access.sources.some((source) => source.path === "services/orders.ts"),
    );
    assert.equal(access.targetId, model.id);
    for (const source of access.sources)
      assert.ok(queries.getNodeDetails(source.nodeId));
  }
  assert.ok(
    !graph.entities.some(
      (entity) =>
        entity.attributes.traceRole === "unresolved" &&
        entity.sources.some(
          (source) => source.path === "app/api/orders/route.ts",
        ),
    ),
  );
  assert.equal(
    queries.getRepositoryGraph().files.length,
    [...input.sources.keys()].filter((path) => /\.tsx?$/.test(path)).length,
  );
  assert.deepEqual(input.database.pragma("foreign_key_check"), []);
});

test("dynamic requests, unsupported clients, invalid models, and Prisma wrappers create boundaries instead of cross-layer edges", async (t) => {
  const input = await fixture(t);
  const source = `import { prisma } from './db/client';
    const fake = { order: { create() {} } };
    function request(url) { return fetch(url); }
    export function cases(url, method, model) {
      fetch(url); fetch('/api/orders', { method });
      fetch('https://external.example/api/orders', {method:'POST'});
      request('/api/orders');
      prisma.missing.create({data:{}}); prisma[model].findMany();
      prisma.order.upsert({}); prisma.order.create({ data: { child: { create: {} } } });
      fake.order.create({});
    }`;
  await writeFile(join(input.root, "negative.ts"), source);
  const result = await indexRepository(input);
  const graph = createGraphQueries(
    input.database,
    result.projectId,
  ).getSemanticGraph(500);
  assert.ok(
    !graph.relationships.some(
      (edge) =>
        ["READS", "WRITES"].includes(edge.kind) &&
        edge.sources.some((source) => source.path === "negative.ts"),
    ),
  );
  assert.ok(
    !graph.relationships.some(
      (edge) =>
        edge.provenance.rule === "literal-http-endpoint" &&
        edge.sources.some((source) => source.path === "negative.ts"),
    ),
  );
  const codes = new Set(
    graph.entities
      .filter((entity) =>
        entity.sources.some((source) => source.path === "negative.ts"),
      )
      .map((entity) => entity.attributes.code),
  );
  for (const code of [
    "dynamic-url",
    "dynamic-http-options",
    "external-or-relative-url",
    "unsupported-prisma-operation",
    "unsupported-prisma-options",
    "unresolved-call",
  ])
    assert.ok(codes.has(code), code);
});

test("form-to-persistence queries return both request branches and supported reverse callers with evidence", async (t) => {
  const input = await fixture(t);
  const indexed = await indexRepository(input);
  const queries = createGraphQueries(input.database, indexed.projectId);
  const entry = queries
    .getBehaviourEntries()
    .entries.find((item) => item.attributes.event === "onSubmit");
  assert.ok(entry);
  const trace = queries.traceBehaviour(entry.id);
  assert.equal(trace.truncated, false);
  assert.equal(trace.paths.length, 2);
  assert.ok(trace.paths.every((path) => path.end === "data-access"));
  const entities = new Map(trace.entities.map((entity) => [entity.id, entity]));
  const effects = new Set(
    trace.paths.map((path) => path.hops.at(-1).relationship.kind),
  );
  assert.deepEqual(effects, new Set(["READS", "WRITES"]));
  for (const path of trace.paths) {
    assert.ok(
      path.entityIds.some((id) => entities.get(id).kind === "endpoint"),
    );
    assert.equal(entities.get(path.entityIds.at(-1)).name, "Order");
    for (const hop of path.hops) {
      assert.equal(hop.relationship.provenance.kind, "deterministic");
      assert.ok(hop.relationship.sources.length > 0);
      for (const source of hop.relationship.sources)
        assert.ok(
          input.sources
            .get(source.path)
            .slice(source.range.start, source.range.end).length > 0,
        );
    }
  }
  const selected = queries
    .searchSymbols({ q: "createOrder" })
    .nodes.find((node) => node.kind === "function");
  const reverse = queries.traceBehaviour(selected.id, { direction: "reverse" });
  assert.ok(reverse.paths.some((path) => path.entityIds.includes(entry.id)));
  assert.ok(reverse.paths.every((path) => path.end === "no-supported-callers"));
});
