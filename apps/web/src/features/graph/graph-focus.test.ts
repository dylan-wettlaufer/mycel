import { expect, test } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { focusGraph, graphConnections } from "./graph-focus";
const nodes: Node[] = ["selected", "caller", "dependency", "isolated"].map(
  (id) => ({ id, position: { x: 0, y: 0 }, data: { label: id } }),
);
const edges: Edge[] = [
  { id: "incoming", source: "caller", target: "selected" },
  { id: "outgoing", source: "selected", target: "dependency" },
  { id: "reciprocal", source: "dependency", target: "selected" },
  { id: "unrelated", source: "caller", target: "dependency" },
];
test("selection traces direct connections, distinguishes direction, and dims links between neighbors", () => {
  const connections = graphConnections(nodes, edges, "selected");
  expect(connections.incoming.map((node) => node.id)).toEqual([
    "caller",
    "dependency",
  ]);
  expect(connections.outgoing.map((node) => node.id)).toEqual(["dependency"]);
  const focused = focusGraph(nodes, edges, "selected", false);
  expect(
    focused.nodes.find((node) => node.id === "selected")?.className,
  ).toContain("graph-selected");
  expect(
    focused.nodes.find((node) => node.id === "isolated")?.className,
  ).toContain("graph-unrelated");
  expect(
    focused.edges.find((edge) => edge.id === "incoming")?.style?.stroke,
  ).toBe("var(--chart-1)");
  expect(
    focused.edges.find((edge) => edge.id === "outgoing")?.style?.stroke,
  ).toBe("var(--primary)");
  expect(focused.edges.find((edge) => edge.id === "unrelated")?.className).toBe(
    "graph-edge-unrelated",
  );
  expect(edges[0]?.style).toBeUndefined();
});
test("connection-only mode keeps direction and restores the complete graph when selection clears or disappears", () => {
  const focused = focusGraph(nodes, edges, "selected", true);
  expect(focused.nodes.map((node) => node.id)).toEqual([
    "selected",
    "caller",
    "dependency",
  ]);
  expect(focused.edges.map((edge) => edge.id)).toEqual([
    "incoming",
    "outgoing",
    "reciprocal",
  ]);
  expect(focusGraph(nodes, edges, null, true).nodes).toHaveLength(4);
  expect(focusGraph(nodes, edges, "deleted-node", true).edges).toHaveLength(4);
});

test("selection keeps uncertainty and arrow direction visible on behaviour edges", () => {
  const [edge] = focusGraph(
    nodes,
    [
      {
        ...edges[0]!,
        type: "behaviour",
        className: "graph-edge-uncertain",
        label: "unresolved",
        style: { strokeDasharray: "2 5" },
      },
    ],
    "selected",
    false,
  ).edges;
  expect(edge).toMatchObject({
    source: "caller",
    target: "selected",
    label: "unresolved",
    markerEnd: { color: "var(--warning)" },
    style: { stroke: "var(--warning)", strokeDasharray: "2 5" },
  });
  expect(edge?.className).toContain("graph-edge-uncertain");
});
