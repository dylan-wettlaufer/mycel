import { expect, test } from "vitest";
import type { Neighborhood } from "@mycel/shared";
import { layoutNeighborhood } from "./layout";
const graph: Neighborhood = {
  projectId: "p",
  revision: 1,
  rootId: "a",
  truncated: false,
  nodes: ["a", "b"].map((id) => ({
    id,
    projectId: "p",
    name: id,
    qualifiedName: id,
    path: `${id}.ts`,
    kind: "file",
    contentHash: "a",
    revision: 1,
    range: {
      start: 0,
      end: 0,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 1,
    },
  })),
  edges: [
    {
      id: "ab",
      projectId: "p",
      revision: 1,
      sourceId: "a",
      targetId: "b",
      kind: "IMPORTS",
    },
    {
      id: "ba",
      projectId: "p",
      revision: 1,
      sourceId: "b",
      targetId: "a",
      kind: "CALLS",
    },
    {
      id: "ab2",
      projectId: "p",
      revision: 1,
      sourceId: "a",
      targetId: "b",
      kind: "CONTAINS",
    },
  ],
};
test("cyclic neighborhoods preserve nodes, parallel edges and selection", () => {
  const result = layoutNeighborhood(graph, "b");
  expect(result.nodes.map((node) => node.id)).toEqual(["a", "b"]);
  expect(
    result.nodes.every(
      (node) =>
        Number.isFinite(node.position.x) && Number.isFinite(node.position.y),
    ),
  ).toBe(true);
  expect(result.nodes[1]?.selected).toBe(true);
  expect(result.edges.map((edge) => edge.id)).toEqual(["ab", "ba", "ab2"]);
  const [a, b] = result.nodes;
  expect(Math.abs(a!.position.x - b!.position.x) - 240).toBeGreaterThanOrEqual(
    180,
  );
});
