import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { openDatabase } from "@mycel/db";
import {
  createGraphQueries,
  indexRepository,
  watchRepository,
} from "../dist/index.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "mycel-features-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = new URL("fixtures/feature-discovery/", import.meta.url);
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
  return { project: { root, name: "features" }, database, root, sources };
}

test("unannotated fixture recognizes Next layouts and only called exported service candidates", async (t) => {
  const input = await fixture(t);
  const indexed = await indexRepository(input);
  const queries = createGraphQueries(input.database, indexed.projectId);
  const graph = queries.getSemanticGraph(500);
  const operations = graph.entities.filter(
    (entity) =>
      entity.kind === "service_operation" &&
      entity.provenance.extractor !== "behaviour-bindings",
  );
  assert.deepEqual(operations.map((entity) => entity.name).sort(), [
    "loadBilling",
    "loadOrders",
    "send",
  ]);
  assert.ok(
    operations.every(
      (entity) =>
        entity.provenance.kind === "heuristic" &&
        entity.attributes.status === "candidate",
    ),
  );
  assert.ok(
    graph.entities.some(
      (entity) =>
        entity.kind === "component" && entity.name === "WorkspaceLayout",
    ),
  );
  const shared = operations.find((entity) => entity.name === "send");
  assert.equal(
    graph.relationships.filter(
      (edge) =>
        edge.kind === "CALLS" &&
        edge.targetId === shared.id &&
        edge.provenance.extractor === "typescript-references",
    ).length,
    2,
  );
  for (const operation of operations) {
    const source = operation.sources[0];
    assert.ok(
      input.sources
        .get(source.path)
        .slice(source.range.start, source.range.end)
        .includes(operation.name),
    );
  }
});

const entity = (graph, name, kind) => {
  const found = graph.entities.find(
    (item) =>
      item.name === name &&
      (kind
        ? item.kind === kind
        : item.provenance.extractor !== "behaviour-bindings"),
  );
  assert.ok(found, `Missing ${kind ?? "entity"} ${name}`);
  return found;
};
const memberships = (graph, target) =>
  new Set(
    graph.relationships
      .filter(
        (edge) => edge.kind === "IMPLEMENTS" && edge.sourceId === target.id,
      )
      .map(
        (edge) =>
          graph.entities.find((item) => item.id === edge.targetId)?.name,
      ),
  );
async function until(check) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline)
      assert.fail("Timed out waiting for feature discovery");
    await setTimeout(25);
  }
}

test("discovers route areas, group-root pages, named feature directories, layouts, and nonexclusive shared dependencies", async (t) => {
  const input = await fixture(t);
  // The same area can have a low-confidence group seed and a stronger URL seed.
  const extraPath = "src/app/marketing/page.tsx";
  const extraSource =
    "export default function MarketingAreaPage() { return <h1>Marketing</h1>; }";
  await mkdir(join(input.root, extraPath, ".."), { recursive: true });
  await writeFile(join(input.root, extraPath), extraSource);
  input.sources.set(extraPath, extraSource);
  const indexed = await indexRepository(input);
  const queries = createGraphQueries(input.database, indexed.projectId);
  const graph = queries.getSemanticGraph(500);
  const features = graph.entities.filter((item) => item.kind === "feature");
  assert.deepEqual(features.map((item) => item.name).sort(), [
    "billing",
    "marketing",
    "orders",
    "reports",
  ]);
  const marketing = features.find((item) => item.name === "marketing");
  assert.equal(marketing.provenance.confidence, 0.8);
  assert.equal(marketing.provenance.rule, "route-area");
  const listed = queries.getFeatures({ status: "candidate" });
  assert.equal(listed.features.length, 4);
  assert.equal(queries.getFeatures({ status: "declared" }).features.length, 0);
  const featureId = features.find((item) => item.name === "orders").id;
  const details = queries.getFeature(featureId);
  assert.ok(details.entities.some((item) => item.name === "loadOrders"));
  assert.ok(
    details.relationships.every(
      (edge) => edge.kind === "IMPLEMENTS" && edge.targetId === featureId,
    ),
  );
  assert.ok(
    features.every(
      (item) =>
        item.attributes.status === "candidate" &&
        item.provenance.kind === "heuristic" &&
        item.provenance.confidence < 1,
    ),
  );
  assert.deepEqual(
    memberships(graph, entity(graph, "SharedButton")),
    new Set(["orders", "billing"]),
  );
  assert.deepEqual(
    memberships(graph, entity(graph, "send")),
    new Set(["orders", "billing"]),
  );
  assert.deepEqual(
    memberships(graph, entity(graph, "WorkspaceLayout")),
    new Set(["orders", "billing"]),
  );
  assert.deepEqual(
    memberships(graph, entity(graph, "Navigation")),
    new Set(["orders", "billing"]),
  );
  assert.deepEqual(
    memberships(graph, entity(graph, "RootLayout")),
    new Set(["orders", "billing", "marketing"]),
  );
  assert.deepEqual(
    memberships(graph, entity(graph, "/orders/[id]", "route")),
    new Set(["orders"]),
  );
  assert.equal(memberships(graph, entity(graph, "SharedPanel")).size, 0);
  const groupRoute = entity(graph, "/", "route");
  assert.ok(
    graph.relationships.some(
      (edge) =>
        edge.sourceId === groupRoute.id &&
        edge.provenance.rule === "route-group",
    ),
  );
  const associations = graph.relationships.filter(
    (edge) => edge.kind === "IMPLEMENTS",
  );
  assert.ok(associations.every((edge) => edge.provenance.kind === "heuristic"));
  const send = entity(graph, "send");
  const orders = entity(graph, "orders", "feature");
  const path = associations.find(
    (edge) => edge.sourceId === send.id && edge.targetId === orders.id,
  );
  assert.ok(
    path.sources.some((source) => source.path.endsWith("orders/page.tsx")),
  );
  assert.ok(
    path.sources.some(
      (source) =>
        input.sources
          .get(source.path)
          .slice(source.range.start, source.range.end) === "send()",
    ),
  );
  for (const record of [...features, ...associations])
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
  assert.deepEqual(input.database.pragma("foreign_key_check"), []);
});

test("explicit feature tags override route seeds and candidate roles and remain authoritative during propagation", async (t) => {
  const input = await fixture(t);
  for (const path of [
    "src/app/(workspace)/orders/page.tsx",
    "src/app/(workspace)/orders/[id]/page.tsx",
  ])
    await writeFile(
      join(input.root, path),
      input.sources
        .get(path)
        .replace(
          "export default",
          "/** @mycelFeature purchases */\nexport default",
        ),
    );
  const service = "src/services/orders.ts";
  await writeFile(
    join(input.root, service),
    input.sources
      .get(service)
      .replace(
        "export function loadOrders",
        "/** @mycelFeature fulfilment */\nexport function loadOrders",
      ),
  );
  const report = "src/features/reports/ReportsPanel.tsx";
  await writeFile(
    join(input.root, report),
    "/** @mycelFeature billing */\n" + input.sources.get(report),
  );
  const indexed = await indexRepository(input);
  const graph = createGraphQueries(
    input.database,
    indexed.projectId,
  ).getSemanticGraph(500);
  assert.deepEqual(
    memberships(graph, entity(graph, "/orders", "route")),
    new Set(["purchases"]),
  );
  assert.deepEqual(
    memberships(graph, entity(graph, "OrdersPage", "page")),
    new Set(["purchases"]),
  );
  assert.deepEqual(
    memberships(graph, entity(graph, "loadOrders")),
    new Set(["fulfilment"]),
  );
  assert.deepEqual(
    memberships(graph, entity(graph, "send")),
    new Set(["fulfilment", "billing"]),
  );
  const route = entity(graph, "/orders", "route");
  const membership = graph.relationships.find(
    (edge) =>
      edge.sourceId === route.id && edge.provenance.rule === "annotated-route",
  );
  const evidence = await Promise.all(
    membership.sources.map(async (source) =>
      (await readFile(join(input.root, source.path), "utf8")).slice(
        source.range.start,
        source.range.end,
      ),
    ),
  );
  assert.ok(evidence.some((text) => text.includes("@mycelFeature purchases")));
  const fulfilment = entity(graph, "fulfilment", "feature");
  assert.equal(fulfilment.attributes.status, "declared");
  assert.equal(fulfilment.provenance.kind, "deterministic");
  assert.ok(
    graph.relationships.some(
      (edge) =>
        edge.sourceId === entity(graph, "loadOrders").id &&
        edge.targetId === fulfilment.id &&
        edge.provenance.kind === "deterministic",
    ),
  );
  const billing = graph.entities.filter(
    (item) => item.kind === "feature" && item.name === "billing",
  );
  assert.equal(billing.length, 1);
  assert.equal(billing[0].attributes.status, "declared");
  assert.ok(
    graph.relationships.some(
      (edge) =>
        edge.sourceId === entity(graph, "/billing", "route").id &&
        edge.targetId === billing[0].id &&
        edge.provenance.kind === "heuristic",
    ),
  );
  const orders = entity(graph, "orders", "feature");
  assert.equal(orders.provenance.rule, "feature-directory");
  assert.ok(
    orders.sources.every((source) => source.path.includes("features/orders/")),
  );
});

test("live discovery removes stale memberships after reference edits, feature/group renames, source moves, and route deletion", async (t) => {
  const input = await fixture(t);
  const errors = [];
  const live = await watchRepository({
    ...input,
    debounceMs: 20,
    onError: (error) => errors.push(error),
  });
  t.after(() => live.close());
  const queries = createGraphQueries(input.database, live.project.id);
  const read = () => queries.getSemanticGraph(500);
  const initial = read();
  const shared = entity(initial, "SharedButton");
  const report = entity(initial, "reports", "feature");
  const group = entity(initial, "marketing", "feature");
  const operation = entity(initial, "loadOrders");
  const panel = "src/features/orders/OrdersPanel.tsx";
  await writeFile(
    join(input.root, panel),
    input.sources.get(panel).replace("<SharedButton />", "<span />"),
  );
  await until(() => !memberships(read(), shared).has("orders"));
  assert.deepEqual(memberships(read(), shared), new Set(["billing"]));
  await rename(
    join(input.root, "src/features/reports"),
    join(input.root, "src/features/analytics"),
  );
  await until(
    () =>
      read().entities.some(
        (item) => item.kind === "feature" && item.name === "analytics",
      ) && !read().entities.some((item) => item.id === report.id),
  );
  assert.ok(
    !read().relationships.some(
      (edge) => edge.sourceId === report.id || edge.targetId === report.id,
    ),
  );
  const analytics = entity(read(), "analytics", "feature");
  const movedReport = join(
    input.root,
    "src/features/analytics/ReportsPanel.tsx",
  );
  const reportSource = input.sources.get(
    "src/features/reports/ReportsPanel.tsx",
  );
  await writeFile(
    movedReport,
    "/** @mycelFeature insights */\n" + reportSource,
  );
  await until(
    () =>
      read().entities.some(
        (item) =>
          item.kind === "feature" &&
          item.name === "insights" &&
          item.attributes.status === "declared",
      ) && !read().entities.some((item) => item.id === analytics.id),
  );
  const insights = entity(read(), "insights", "feature");
  await writeFile(movedReport, reportSource);
  await until(
    () =>
      read().entities.some((item) => item.id === analytics.id) &&
      !read().entities.some((item) => item.id === insights.id),
  );
  await rename(
    join(input.root, "src/app/(marketing)"),
    join(input.root, "src/app/(public)"),
  );
  await until(
    () =>
      read().entities.some(
        (item) => item.kind === "feature" && item.name === "public",
      ) && !read().entities.some((item) => item.id === group.id),
  );
  assert.ok(!read().relationships.some((edge) => edge.targetId === group.id));
  await mkdir(join(input.root, "src/lib"));
  await rename(
    join(input.root, "src/services/orders.ts"),
    join(input.root, "src/lib/orders.ts"),
  );
  await writeFile(
    join(input.root, panel),
    input.sources
      .get(panel)
      .replace("../../services/orders", "../../lib/orders")
      .replace("<SharedButton />", "<span />"),
  );
  await until(() => !read().entities.some((item) => item.id === operation.id));
  assert.ok(
    !read().relationships.some(
      (edge) =>
        edge.sourceId === operation.id || edge.targetId === operation.id,
    ),
  );
  const billing = entity(read(), "billing", "feature");
  await rm(join(input.root, "src/app/(workspace)/billing/page.tsx"));
  await until(() => !read().entities.some((item) => item.id === billing.id));
  assert.equal(memberships(read(), shared).size, 0);
  assert.ok(
    !read()
      .entities.flatMap((item) => item.sources)
      .some(
        (source) =>
          source.path.startsWith("src/features/reports/") ||
          source.path.startsWith("src/app/(marketing)/"),
      ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(input.database.pragma("foreign_key_check"), []);
});
