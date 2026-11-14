import dagre from "@dagrejs/dagre";
import { MarkerType, Position, type Node, type Edge } from "@xyflow/react";
import type { Neighborhood } from "@mycel/shared";

export function layoutNeighborhood(
  graph: Neighborhood,
  selectedId: string,
): { nodes: Node[]; edges: Edge[] } {
  const layout = new dagre.graphlib.Graph({
    multigraph: true,
  }).setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: "LR", nodesep: 35, ranksep: 100 });
  for (const node of graph.nodes)
    layout.setNode(node.id, { width: 220, height: 70 });
  for (const edge of graph.edges)
    layout.setEdge(edge.sourceId, edge.targetId, {}, edge.id);
  dagre.layout(layout);
  return {
    nodes: graph.nodes.map((node) => {
      const position = layout.node(node.id);
      return {
        id: node.id,
        data: { label: `${node.kind} · ${node.name}` },
        position: { x: position.x - 110, y: position.y - 35 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        selected: node.id === selectedId,
        className: `graph-node graph-node-${node.kind}`,
        style: { width: 220, minHeight: 70 },
      };
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      label: edge.kind.toLowerCase(),
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke:
          edge.kind === "CALLS" ? "var(--primary)" : "var(--muted-foreground)",
        strokeDasharray: edge.kind === "CONTAINS" ? "4 4" : undefined,
      },
    })),
  };
}
