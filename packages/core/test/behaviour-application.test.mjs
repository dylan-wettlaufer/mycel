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
import { setTimeout } from "node:timers/promises";
import { openDatabase } from "@mycel/db";
import { parseFile } from "@mycel/parser";
import {
  createGraphQueries,
  indexRepository,
  watchRepository,
} from "../dist/index.js";

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
  assert.ok(
    requests.every(
      (request) =>
        request.attributes.binding === "resolved" &&
        request.attributes.url === "/api/orders",
    ),
  );
  assert.deepEqual(
    new Set(requests.map((request) => request.attributes.method)),
    new Set(["GET", "POST"]),
  );
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
      prisma.$transaction([prisma.order.create({data:{title:'wrapped'}})]);
      prisma.order.findMany();
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
    "unsupported-prisma-consumption",
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

test("feature behaviour joins member symbols to UI events from the same revision", async (t) => {
  const input = await fixture(t);
  // A second component in the same file must not supply an Orders event.
  await writeFile(
    join(input.root, "OrderForm.tsx"),
    input.sources.get("OrderForm.tsx") +
      "\n/** @mycelFeature support */\n" +
      "export function SupportButton() { return <button onClick={() => {}}>Help</button>; }\n",
  );
  const indexed = await indexRepository(input);
  const queries = createGraphQueries(input.database, indexed.projectId);
  const { features } = queries.getFeatures();
  const orders = features.find(({ name }) => name === "orders");
  const support = features.find(({ name }) => name === "support");
  assert.ok(orders && support);

  const detail = queries.getFeatureBehaviour(orders.id);
  assert.equal(detail.featureId, orders.id);
  assert.equal(detail.revision, indexed.revision);
  assert.equal(detail.truncated, false);
  assert.ok(detail.entities.some(({ name }) => name === "OrderForm"));
  assert.deepEqual(
    detail.traces.map(({ revision }) => revision),
    [detail.revision],
  );
  const [trace] = detail.traces;
  assert.equal(
    trace.entities.find(({ id }) => id === trace.rootId).name,
    "form.onSubmit",
  );
  assert.deepEqual(
    new Set(trace.paths.map(({ hops }) => hops.at(-1).relationship.kind)),
    new Set(["READS", "WRITES"]),
  );

  const supportTrace = queries.getFeatureBehaviour(support.id).traces[0];
  assert.equal(
    supportTrace.entities.find(({ id }) => id === supportTrace.rootId).name,
    "button.onClick",
  );
  const limited = queries.getFeatureBehaviour(orders.id, 1);
  assert.equal(limited.truncated, true);
  assert.deepEqual(limited.traces, []);
});

async function until(check) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline)
      assert.fail("Timed out waiting for a trace update");
    await setTimeout(25);
  }
}

test("incremental edits replace accesses, HTTP links, handlers, and schema evidence atomically while retaining last good TS", async (t) => {
  const input = await fixture(t);
  const errors = [];
  const parsed = [];
  const live = await watchRepository({
    ...input,
    debounceMs: 20,
    onError: (error) => errors.push(error),
    parse: (path, source) => {
      parsed.push(path);
      return parseFile(path, source);
    },
  });
  t.after(() => live.close());
  const queries = createGraphQueries(input.database, live.project.id);
  const entry = queries.getBehaviourEntries().entries[0];
  const read = () => queries.traceBehaviour(entry.id);
  const snapshot = () => queries.getSemanticGraph(500);
  const complete = () =>
    read()?.paths.length === 2 &&
    read().paths.every((path) => path.end === "data-access");
  assert.ok(complete());
  const first = read();
  const originalWrite = first.paths
    .flatMap((path) => path.hops)
    .find((hop) => hop.relationship.kind === "WRITES").relationship.id;
  const postLink = first.paths
    .flatMap((path) => path.hops)
    .find(
      (hop) =>
        hop.relationship.provenance.rule === "literal-http-endpoint" &&
        first.entities.find((entity) => entity.id === hop.toId)?.attributes
          .method === "POST",
    ).relationship.id;
  const service = "services/orders.ts";
  await writeFile(
    join(input.root, service),
    input.sources
      .get(service)
      .replace(
        "database.order.create({ data: { title: input.title } })",
        "database.order.findUnique({ where: { id: input.title } })",
      ),
  );
  await until(
    () =>
      complete() &&
      read().paths.every(
        (path) => path.hops.at(-1).relationship.kind === "READS",
      ),
  );
  assert.ok(
    !snapshot().relationships.some((edge) => edge.id === originalWrite),
  );
  await writeFile(
    join(input.root, "submit.ts"),
    input.sources
      .get("submit.ts")
      .replace("fetch('/api/orders',", "fetch(`/api/${input.title}`,"),
  );
  await until(() =>
    read().paths.some((path) => path.boundary?.code === "dynamic-url"),
  );
  assert.ok(!snapshot().relationships.some((edge) => edge.id === postLink));
  await writeFile(
    join(input.root, "submit.ts"),
    input.sources.get("submit.ts"),
  );
  await writeFile(join(input.root, service), input.sources.get(service));
  await until(
    () =>
      complete() &&
      read().paths.some(
        (path) => path.hops.at(-1).relationship.kind === "WRITES",
      ),
  );
  // A metadata-only edit must invalidate every old Prisma delegate edge.
  const model = snapshot().entities.find(
    (entity) =>
      entity.attributes.provider === "prisma" && entity.kind === "data_model",
  );
  parsed.length = 0;
  await writeFile(
    join(input.root, "prisma/schema.prisma"),
    input.sources
      .get("prisma/schema.prisma")
      .replace("model Order", "model Purchase"),
  );
  await until(() =>
    read().paths.every(
      (path) => path.boundary?.code === "unsupported-prisma-operation",
    ),
  );
  assert.equal(parsed.length, 0);
  assert.ok(!snapshot().entities.some((entity) => entity.id === model.id));
  assert.ok(
    !snapshot().relationships.some((edge) =>
      ["READS", "WRITES"].includes(edge.kind),
    ),
  );
  await writeFile(
    join(input.root, "prisma/schema.prisma"),
    input.sources.get("prisma/schema.prisma"),
  );
  await until(complete);
  // Configuration is explicitly unsupported, rather than guessing its schema.
  await writeFile(
    join(input.root, "prisma.config.ts"),
    "export default { schema: 'elsewhere.prisma' };",
  );
  await until(() =>
    read().paths.every(
      (path) => path.boundary?.code === "unsupported-prisma-config",
    ),
  );
  await rm(join(input.root, "prisma.config.ts"));
  await until(complete);
  await writeFile(
    join(input.root, "OrderForm.tsx"),
    input.sources.get("OrderForm.tsx") + "\nconst broken = ;",
  );
  await until(() => live.lastUpdate?.retainedPaths.includes("OrderForm.tsx"));
  assert.ok(complete());
  await writeFile(
    join(input.root, "OrderForm.tsx"),
    input.sources
      .get("OrderForm.tsx")
      .replace("onSubmit={handleSubmit}", "onSubmit={wrap(handleSubmit)}"),
  );
  await until(
    () =>
      read().paths.length === 1 &&
      read().paths[0].boundary?.code === "unresolved-event-handler",
  );
  assert.equal(
    queries.getBehaviourEntries().entries[0].attributes.binding,
    "unresolved",
  );
  await writeFile(
    join(input.root, "OrderForm.tsx"),
    input.sources.get("OrderForm.tsx"),
  );
  await until(complete);
  const endpoint = snapshot().entities.find(
    (entity) =>
      entity.kind === "endpoint" && entity.attributes.method === "POST",
  );
  await writeFile(
    join(input.root, "app/api/orders/route.ts"),
    input.sources
      .get("app/api/orders/route.ts")
      .replace("export async function POST", "async function POST"),
  );
  await until(() =>
    read().paths.some((path) => path.boundary?.code === "unresolved-endpoint"),
  );
  assert.ok(!snapshot().entities.some((entity) => entity.id === endpoint.id));
  assert.ok(
    !snapshot().relationships.some(
      (edge) => edge.sourceId === endpoint.id || edge.targetId === endpoint.id,
    ),
  );
  await rm(join(input.root, "OrderForm.tsx"));
  await until(() => queries.getBehaviourEntries().entries.length === 0);
  assert.equal(read(), undefined);
  assert.ok(
    !snapshot()
      .entities.flatMap((entity) => entity.sources)
      .some((source) => source.path === "OrderForm.tsx"),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(input.database.pragma("foreign_key_check"), []);
});

test("ambiguous call bindings and shadowed fetch never borrow older semantic hints to invent trace paths", async (t) => {
  const input = await fixture(t);
  await writeFile(
    join(input.root, "ambiguous.ts"),
    `
    /** @mycelService */ export function save() {}
    export function replacement() {}
    save = replacement;
    /** @mycelService */ export function ambiguous() { save(); }
    const choice = condition ? save : replacement;
    export function conditional() { choice(); }
    export function shadowed(fetch) { return fetch('/api/orders', {method:'POST'}); }
  `,
  );
  const indexed = await indexRepository(input);
  const queries = createGraphQueries(input.database, indexed.projectId);
  for (const name of ["ambiguous", "conditional", "shadowed"]) {
    const root = queries
      .searchSymbols({ q: name })
      .nodes.find((node) => node.kind === "function" && node.name === name);
    const trace = queries.traceBehaviour(root.id);
    assert.equal(trace.paths.length, 1);
    assert.equal(trace.paths[0].end, "unresolved");
    assert.ok(
      !trace.entities.some(
        (entity) => entity.kind === "endpoint" || entity.name === "save",
      ),
    );
  }
});

test("use server actions remain explicit boundaries rather than implicit RPC links", async (t) => {
  const input = await fixture(t);
  await writeFile(
    join(input.root, "server-actions.ts"),
    `"use server";
    import { prisma } from './db/client';
    export async function serverAction() { return prisma.order.create({data:{title:'Action'}}); }`,
  );
  await writeFile(
    join(input.root, "actions-client.ts"),
    `import { serverAction } from './server-actions';
    export async function invokeAction() { return serverAction(); }`,
  );
  const indexed = await indexRepository(input);
  const queries = createGraphQueries(input.database, indexed.projectId);
  for (const name of ["invokeAction", "serverAction"]) {
    const selected = queries
      .searchSymbols({ q: name })
      .nodes.find((node) => node.kind === "function" && node.name === name);
    const trace = queries.traceBehaviour(selected.id);
    assert.equal(trace.paths[0].end, "unresolved");
    assert.equal(trace.paths[0].boundary.code, "unsupported-server-action");
    assert.ok(
      !trace.entities.some(
        (entity) => entity.attributes.traceRole === "prisma_operation",
      ),
    );
  }
});
