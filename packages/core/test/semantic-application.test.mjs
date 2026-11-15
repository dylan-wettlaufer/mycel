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
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { openDatabase } from "@mycel/db";
import {
  createGraphQueries,
  indexRepository,
  watchRepository,
} from "../dist/index.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "mycel-semantic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = new URL("fixtures/semantic-next/", import.meta.url);
  const sources = new Map();
  for (const name of await readdir(directory, { recursive: true })) {
    if (!name.endsWith(".txt")) continue;
    const path = name.slice(0, -4);
    const source = await readFile(new URL(name, directory), "utf8");
    sources.set(path, source);
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), source);
  }
  const database = openDatabase({ databasePath: ":memory:" });
  t.after(() => database.close());
  return { root, database, sources, project: { name: "orders", root } };
}
const find = (graph, kind, name) => {
  const entity = graph.entities.find(
    (item) => item.kind === kind && item.name === name,
  );
  assert.ok(entity, `Missing ${kind}: ${name}`);
  return entity;
};
function assertPath(graph, steps) {
  for (let index = 0; index < steps.length - 2; index += 2) {
    const source = steps[index];
    const kind = steps[index + 1];
    const target = steps[index + 2];
    assert.ok(
      graph.relationships.some(
        (edge) =>
          edge.sourceId === source.id &&
          edge.targetId === target.id &&
          edge.kind === kind,
      ),
      `Missing ${source.name} ${kind} ${target.name}`,
    );
  }
}
async function until(check) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline)
      assert.fail("Timed out waiting for semantic update");
    await setTimeout(25);
  }
}

test("indexes a complete Next application path and explicit semantic declarations with real structural anchors", async (t) => {
  const input = await fixture(t);
  const indexed = await indexRepository(input);
  const queries = createGraphQueries(input.database, indexed.projectId);
  const graph = queries.getSemanticGraph();
  const route = find(graph, "route", "/orders");
  const page = find(graph, "page", "OrdersPage");
  const component = find(graph, "component", "OrdersPanel");
  const operation = find(graph, "service_operation", "listOrders");
  const external = find(graph, "external_dependency", "orders-sdk/client");
  const handler = find(graph, "service_operation", "GET");
  const endpoint = find(graph, "endpoint", "GET /api/orders");
  const feature = find(graph, "feature", "orders");
  find(graph, "data_model", "Order");
  assertPath(graph, [
    route,
    "RENDERS",
    page,
    "RENDERS",
    component,
    "CALLS",
    operation,
    "DEPENDS_ON",
    external,
  ]);
  assertPath(graph, [handler, "HANDLES", endpoint]);
  assertPath(graph, [handler, "CALLS", operation, "IMPLEMENTS", feature]);
  const neighborhood = queries.getSemanticNeighborhood(route.id, { depth: 4 });
  assert.ok(neighborhood.entities.some((entity) => entity.id === external.id));
  assert.equal(graph.revision, indexed.revision);
  assert.ok(
    !graph.relationships.some(
      (edge) => edge.kind === "READS" || edge.kind === "WRITES",
    ),
  );
  for (const record of [...graph.entities, ...graph.relationships]) {
    assert.equal(record.provenance.kind, "deterministic");
    for (const source of record.sources) {
      const structural = queries.getNodeDetails(source.nodeId).node;
      assert.equal(structural.path, source.path);
      assert.ok(
        source.range.start >= structural.range.start &&
          source.range.end <= structural.range.end,
      );
      assert.ok(
        input.sources
          .get(source.path)
          .slice(source.range.start, source.range.end).length > 0,
      );
    }
  }
  assert.equal(queries.getRepositoryGraph().files.length, 5);
  assert.deepEqual(input.database.pragma("foreign_key_check"), []);
});

test("live source, export, annotation, deletion, and manifest changes remove stale semantic relationships", async (t) => {
  const input = await fixture(t);
  const errors = [];
  const live = await watchRepository({
    ...input,
    debounceMs: 20,
    onError: (error) => errors.push(error),
  });
  t.after(() => live.close());
  const queries = createGraphQueries(input.database, live.project.id);
  const read = () => queries.getSemanticGraph();
  const initial = read();
  const component = find(initial, "component", "OrdersPanel");
  const operation = find(initial, "service_operation", "listOrders");
  assertPath(initial, [component, "CALLS", operation]);
  const servicePath = "src/services/orders.ts";
  const original = input.sources.get(servicePath);
  // An unchanged consumer must lose its CALLS edge when the export disappears.
  await writeFile(
    join(input.root, servicePath),
    original.replace("export function", "function"),
  );
  await until(
    () =>
      !read().relationships.some(
        (edge) => edge.sourceId === component.id && edge.kind === "CALLS",
      ),
  );
  assert.equal(
    find(read(), "service_operation", "listOrders").id,
    operation.id,
  );
  await writeFile(join(input.root, servicePath), original);
  await until(() =>
    read().relationships.some(
      (edge) =>
        edge.sourceId === component.id && edge.targetId === operation.id,
    ),
  );
  // Syntax errors retain the last good semantic and structural source together.
  await writeFile(
    join(input.root, servicePath),
    "export function listOrders( {",
  );
  await until(() => live.lastUpdate?.retainedPaths.includes(servicePath));
  assertPath(read(), [component, "CALLS", operation]);
  // Removing a declaration annotation removes the operation and all dependent edges.
  await writeFile(
    join(input.root, servicePath),
    original.replace(" * @mycelService\n", ""),
  );
  await until(
    () => !read().entities.some((entity) => entity.id === operation.id),
  );
  assert.ok(
    !read().relationships.some(
      (edge) =>
        edge.targetId === operation.id || edge.sourceId === operation.id,
    ),
  );
  await rm(join(input.root, "src/components/OrdersPanel.tsx"));
  await until(
    () => !read().entities.some((entity) => entity.id === component.id),
  );
  assert.ok(
    !read().relationships.some(
      (edge) =>
        edge.targetId === component.id || edge.sourceId === component.id,
    ),
  );
  // Metadata changes re-evaluate framework conventions without changing source.
  await writeFile(join(input.root, "package.json"), '{"name":"no-framework"}');
  await until(
    () =>
      !read().entities.some(
        (entity) => entity.kind === "route" || entity.kind === "endpoint",
      ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(input.database.pragma("foreign_key_check"), []);
});

test("Next conventions require an owning Next package and omit unsupported or conflicting routes", async (t) => {
  const input = await fixture(t);
  const additions = {
    "src/app/_internal/page.tsx":
      "export default function Private() { return <div/>; }",
    "src/app/@modal/page.tsx":
      "export default function Modal() { return <div/>; }",
    "src/app/(.)other/page.tsx":
      "export default function Intercepted() { return <div/>; }",
    "src/app/items/[id]/page.tsx":
      "export default function Item() { return <div/>; }",
    "src/app/items/api/route.ts":
      "const handler = () => new Response(); export { handler as POST };",
    "src/app/(duplicate)/orders/page.tsx":
      "export default function Duplicate() { return <div/>; }",
    "other/package.json": "{}",
    "other/src/app/page.tsx":
      "export default function Other() { return <div/>; }",
  };
  for (const [path, source] of Object.entries(additions)) {
    await mkdir(join(input.root, path, ".."), { recursive: true });
    await writeFile(join(input.root, path), source);
  }
  const indexed = await indexRepository(input);
  const graph = createGraphQueries(
    input.database,
    indexed.projectId,
  ).getSemanticGraph();
  assert.deepEqual(
    graph.entities
      .filter((entity) => entity.kind === "route")
      .map((entity) => entity.name),
    ["/items/[id]"],
  );
  const handler = find(graph, "service_operation", "handler");
  assertPath(graph, [
    handler,
    "HANDLES",
    find(graph, "endpoint", "POST /items/api"),
  ]);
  assert.ok(
    !graph.entities.some(
      (entity) =>
        entity.kind === "page" &&
        [
          "Private",
          "Modal",
          "Intercepted",
          "Other",
          "Duplicate",
          "OrdersPage",
        ].includes(entity.name),
    ),
  );
});
