import dagre from "@dagrejs/dagre";
import { MarkerType, Position, type Node, type Edge } from "@xyflow/react";
import type { ChangeAction, Neighborhood } from "@mycel/shared";

export function layoutNeighborhood(
  graph: Neighborhood,
  selectedId: string,
  recent: Map<string, ChangeAction> = new Map(),
): { nodes: Node[]; edges: Edge[] } {
  const layout = new dagre.graphlib.Graph({
    multigraph: true,
  }).setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 85 });
  for (const node of graph.nodes)
    layout.setNode(node.id, { width: 240, height: 100 });
  for (const edge of graph.edges)
    layout.setEdge(edge.sourceId, edge.targetId, {}, edge.id);
  dagre.layout(layout);
  return {
    nodes: graph.nodes.map((node) => {
      const position = layout.node(node.id);
      return {
        id: node.id,
        type: "code",
        ariaLabel: `${node.kind} ${node.qualifiedName}, ${node.path}:${node.range.startLine}`,
        data: {
          name: node.name,
          context:
            node.kind === "file"
              ? node.path.split("/").slice(0, -1).join("/") || "(root)"
              : `${node.path}:${node.range.startLine}`,
          kind: node.kind,
          change: recent.get(node.id),
          label: `${node.kind} · ${node.name}${recent.has(node.id) ? ` · ${recent.get(node.id)}` : ""}`,
        },
        position: { x: position.x - 120, y: position.y - 50 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        selected: node.id === selectedId,
        className: `graph-node graph-node-${node.kind}${recent.has(node.id) ? ` recent-${recent.get(node.id)}` : ""}`,
        style: { width: 240, height: 100 },
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
