import assert from "node:assert/strict";
import test from "node:test";
import { diffGraph } from "../dist/history.js";
test("graph diff ignores revisions and key order but detects nodes and edges", () => {
  const a = { id: "a", path: "a.ts", contentHash: "1", revision: 1 };
  const b = { id: "b", path: "b.ts", contentHash: "1", revision: 1 };
  const edge = {
    id: "edge",
    sourceId: "a",
    targetId: "b",
    kind: "IMPORTS",
    revision: 1,
  };
  assert.deepEqual(
    diffGraph(
      { nodes: [a], edges: [] },
      {
        nodes: [{ contentHash: "1", path: "a.ts", id: "a", revision: 2 }],
        edges: [],
      },
    ),
    [],
  );
  const changes = diffGraph(
    { nodes: [a, b], edges: [edge] },
    {
      nodes: [
        { ...a, contentHash: "2" },
        { ...b, id: "c" },
      ],
      edges: [{ ...edge, targetId: "c" }],
    },
  );
  assert.deepEqual(
    changes.map((e) => [e.entityId, e.action]),
    [
      ["a", "modified"],
      ["b", "deleted"],
      ["c", "created"],
      ["edge", "modified"],
    ],
  );
});
