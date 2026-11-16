import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseFile } from "@mycel/parser";
import { buildProjectGraph } from "../dist/graph.js";
import { extractSemanticGraph } from "../dist/index.js";

// Foundation assertions exclude the additive behaviour operation layer.
const foundationRecord = (record) =>
  !["behaviour-bindings", "native-fetch", "prisma"].includes(
    record.provenance.extractor,
  );
const project = {
  id: "project:semantic",
  name: "fixture",
  root: "/fixture",
  indexing: {
    extensions: [".ts", ".tsx"],
    exclude: [],
    respectGitignore: true,
  },
};
async function captureFixture() {
  return Promise.all(
    ["App.tsx", "Card.tsx", "barrel.ts"].map(async (path) => {
      const source = await readFile(
        new URL(`fixtures/semantic-react/${path}.txt`, import.meta.url),
        "utf8",
      );
      return { source, parsed: parseFile(path, source) };
    }),
  );
}

test("React fixture resolves JSX aliases and reexports, direct dependencies, source mappings, and shadowing", async () => {
  const files = await captureFixture();
  const graph = buildProjectGraph(project, files);
  const entities = graph.semantic.entities.filter(foundationRecord);
  const relationships = graph.semantic.relationships.filter(foundationRecord);
  const find = (name) => entities.find((entity) => entity.name === name);
  assert.deepEqual(
    entities
      .filter((entity) => entity.kind === "component")
      .map((entity) => entity.name),
    ["App", "Shadowed", "Card"],
  );
  assert.equal(relationships.length, 2);
  assert.ok(
    relationships.some(
      (edge) =>
        edge.kind === "RENDERS" &&
        edge.sourceId === find("App").id &&
        edge.targetId === find("Card").id,
    ),
  );
  assert.ok(
    relationships.some(
      (edge) =>
        edge.kind === "DEPENDS_ON" &&
        edge.sourceId === find("App").id &&
        edge.targetId === find("display-sdk").id,
    ),
  );
  assert.ok(
    !relationships.some((edge) => edge.sourceId === find("Shadowed").id),
  );
  const render = relationships.find((edge) => edge.kind === "RENDERS");
  const evidence = render.sources[0];
  const source = files.find(
    (file) => file.parsed.path === evidence.path,
  ).source;
  assert.equal(
    source.slice(evidence.range.start, evidence.range.end),
    "<Panel />",
  );
  for (const record of [...entities, ...relationships]) {
    assert.equal(record.provenance.kind, "deterministic");
    assert.equal(record.provenance.confidence, 1);
    for (const mapping of record.sources) {
      const anchor = graph.nodes.find((node) => node.id === mapping.nodeId);
      assert.equal(anchor.path, mapping.path);
      assert.ok(
        mapping.range.start >= anchor.range.start &&
          mapping.range.end <= anchor.range.end,
      );
    }
  }
  const shifted = buildProjectGraph(
    project,
    files.map((file) => ({
      source: `// moved\n${file.source}`,
      parsed: parseFile(file.parsed.path, `// moved\n${file.source}`),
    })),
  );
  assert.deepEqual(
    shifted.semantic.entities
      .filter(foundationRecord)
      .map((entity) => entity.id),
    entities.map((entity) => entity.id),
  );
  assert.deepEqual(
    shifted.semantic.relationships
      .filter(foundationRecord)
      .map((edge) => edge.id),
    relationships.map((edge) => edge.id),
  );
});

test("semantic extractors compose over structural captures without changing structural output", async () => {
  const files = await captureFixture();
  const graph = buildProjectGraph(project, files);
  let called = false;
  const result = extractSemanticGraph({ project, files, nodes: graph.nodes }, [
    (context) => {
      called = true;
      assert.equal(context.project.id, project.id);
      assert.ok(
        context.callables.some((callable) => callable.anchor.name === "App"),
      );
      return { entities: [], relationships: [] };
    },
  ]);
  assert.equal(called, true);
  assert.ok(
    result.entities
      .filter(foundationRecord)
      .every((entity) => entity.kind === "external_dependency"),
  );
  assert.equal(result.relationships.filter(foundationRecord).length, 0);
  assert.ok(graph.edges.some((edge) => edge.kind === "CALLS") === false);
});

test("explicit annotations map arrow operations and model declarations without guessing data access or directory meanings", () => {
  const source = `
/** @mycelModel */
export class Order { id = ''; }
/** @mycelModel */
export type Receipt = { id: string };
/** @mycelService */
export const save = () => 1;
export function pretendService() { return 1; }
export interface PretendModel { id: string }
`;
  const files = [{ source, parsed: parseFile("services/models.ts", source) }];
  const graph = buildProjectGraph(project, files);
  assert.deepEqual(
    graph.semantic.entities
      .filter(foundationRecord)
      .map((entity) => [entity.kind, entity.name])
      .sort(),
    [
      ["data_model", "Order"],
      ["data_model", "Receipt"],
      ["service_operation", "save"],
    ],
  );
  const model = graph.semantic.entities.find(
    (entity) => entity.name === "Order",
  );
  assert.equal(
    graph.nodes.find((node) => node.id === model.sources[0].nodeId).kind,
    "class",
  );
  const receipt = graph.semantic.entities.find(
    (entity) => entity.name === "Receipt",
  );
  assert.equal(
    graph.nodes.find((node) => node.id === receipt.sources[0].nodeId).kind,
    "file",
  );
  assert.equal(graph.semantic.relationships.filter(foundationRecord).length, 0);
});

test("ambiguous star exports and type-only bindings never create runtime semantic edges", () => {
  const sources = {
    "App.tsx":
      "import { Card } from './barrel'; export function App() { return <Card/>; }",
    "Typed.tsx":
      "import type { Card } from './one'; export function Typed() { return <Card/>; }",
    "TypeBarrel.tsx":
      "import { Card } from './types'; export function TypeBarrel() { return <Card/>; }",
    "Namespace.tsx":
      "import type * as UI from './one'; export function Namespace() { return <UI.Card/>; }",
    "TypesOnly.ts": "import { type Config } from 'types-only-sdk';",
    "Host.tsx":
      "import { div } from 'host-sdk'; export function Host() { return <div/>; }",
    "barrel.ts": "export * from './one'; export * from './two';",
    "types.ts": "export type { Card } from './one';",
    "one.tsx": "export function Card() { return <div/>; }",
    "two.tsx": "export function Card() { return <section/>; }",
  };
  const files = Object.entries(sources).map(([path, source]) => ({
    source,
    parsed: parseFile(path, source),
  }));
  const graph = buildProjectGraph(project, files);
  assert.equal(graph.semantic.relationships.filter(foundationRecord).length, 0);
  assert.ok(
    !graph.semantic.entities.some((entity) => entity.name === "types-only-sdk"),
  );
});
