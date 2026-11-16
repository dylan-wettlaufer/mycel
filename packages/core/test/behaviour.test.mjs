import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseFile } from "@mycel/parser";
import { buildProjectGraph } from "../dist/graph.js";
const project = {
  id: "p",
  root: "/fixture",
  name: "behaviour",
  indexing: {
    extensions: [".ts", ".tsx"],
    exclude: [],
    respectGitignore: true,
  },
};
const capture = (sources) =>
  Object.entries(sources).map(([path, source]) => ({
    source,
    parsed: parseFile(path, source),
  }));
const role = (graph, name, traceRole = "callable") => {
  const item = graph.entities.find(
    (entity) =>
      entity.name === name && entity.attributes.traceRole === traceRole,
  );
  assert.ok(item, `Missing ${traceRole}: ${name}`);
  return item;
};

test("binds named and inline nested DOM callbacks without treating callback creation as invocation", async () => {
  const sources = Object.fromEntries(
    await Promise.all(
      ["Form.tsx", "client.ts"].map(async (path) => [
        path,
        await readFile(
          new URL(`fixtures/behaviour/${path}.txt`, import.meta.url),
          "utf8",
        ),
      ]),
    ),
  );
  const graph = buildProjectGraph(project, capture(sources));
  const semantic = graph.semantic;
  const submit = role(semantic, "handleSubmit");
  const click = role(semantic, "handleClick");
  const client = role(semantic, "submitOrder");
  const form = role(semantic, "OrderForm");
  const event = role(semantic, "form.onSubmit", "ui_event");
  const inline = semantic.relationships.find(
    (edge) => edge.sourceId === event.id && edge.kind === "CALLS",
  ).targetId;
  for (const [source, target] of [
    [inline, submit.id],
    [submit.id, client.id],
    [click.id, client.id],
    [form.id, event.id],
  ])
    assert.ok(
      semantic.relationships.some(
        (edge) =>
          edge.kind === "CALLS" &&
          edge.sourceId === source &&
          edge.targetId === target,
      ),
    );
  assert.ok(
    !semantic.relationships.some(
      (edge) =>
        edge.sourceId === form.id &&
        [submit.id, click.id, client.id].includes(edge.targetId),
    ),
  );
  for (const edge of semantic.relationships.filter(
    (edge) => edge.provenance.extractor === "behaviour-bindings",
  )) {
    assert.equal(edge.provenance.kind, "deterministic");
    for (const source of edge.sources) {
      const anchor = graph.nodes.find((node) => node.id === source.nodeId);
      assert.equal(source.path, anchor.path);
      assert.ok(
        source.range.start >= anchor.range.start &&
          source.range.end <= anchor.range.end,
      );
      assert.ok(
        sources[source.path].slice(source.range.start, source.range.end)
          .length > 0,
      );
    }
  }
});

test("mutable/conditional calls, callback wrappers, custom event props, and type-only targets stop at explicit boundaries", () => {
  const sources = {
    "Form.tsx": `import type { send } from './client';
      function save() {} function remove() {}
      let action = save; action = remove;
      const conditional = flag ? save : remove;
      function handler() { action(); conditional(); send(); }
      export function Form() { return <form onSubmit={wrap(handler)}><Widget onClick={handler}/><button onClick={handler}/></form>; }`,
    "Spreads.tsx":
      "export function Spreads(props) { function submit() {} return <form onSubmit={submit} {...props}/>; }",
    "client.ts": "export function send() {}",
  };
  const graph = buildProjectGraph(project, capture(sources)).semantic;
  const handler = role(graph, "handler");
  const targets = graph.relationships
    .filter((edge) => edge.sourceId === handler.id)
    .map((edge) =>
      graph.entities.find((entity) => entity.id === edge.targetId),
    );
  assert.equal(targets.length, 3);
  assert.ok(
    targets.every((entity) => entity.attributes.traceRole === "unresolved"),
  );
  assert.ok(
    graph.entities.some(
      (entity) => entity.attributes.code === "unresolved-event-handler",
    ),
  );
  assert.ok(
    graph.entities.some(
      (entity) => entity.attributes.code === "unsupported-event-prop",
    ),
  );
  assert.ok(
    graph.entities.some(
      (entity) => entity.attributes.code === "ambiguous-event-props",
    ),
  );
  assert.ok(
    graph.relationships.some(
      (edge) =>
        edge.sourceId === role(graph, "button.onClick", "ui_event").id &&
        edge.targetId === handler.id,
    ),
  );
});
