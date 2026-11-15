import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseFile } from "@mycel/parser";
import { buildProjectGraph } from "../dist/graph.js";
import { extractSemanticGraph } from "../dist/index.js";

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
  const { entities, relationships } = graph.semantic;
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
    shifted.semantic.entities.map((entity) => entity.id),
    entities.map((entity) => entity.id),
  );
  assert.deepEqual(
    shifted.semantic.relationships.map((edge) => edge.id),
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
    result.entities.every((entity) => entity.kind === "external_dependency"),
  );
  assert.equal(result.relationships.length, 0);
  assert.ok(graph.edges.some((edge) => edge.kind === "CALLS") === false);
});
