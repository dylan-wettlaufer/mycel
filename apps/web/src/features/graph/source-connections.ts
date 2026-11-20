import type { EdgeSourceRange, GraphNode, Neighborhood } from "@mycel/shared";

interface SourceConnection {
  source: GraphNode;
  label: string;
  ranges: EdgeSourceRange[];
}

export function sourceConnections(neighborhood: Neighborhood) {
  const nodes = new Map(neighborhood.nodes.map((node) => [node.id, node]));
  const connections = new Map<string, SourceConnection>();
  for (const edge of neighborhood.edges) {
    if (edge.kind === "CONTAINS" || !edge.sourceRanges?.length) continue;
    const source = nodes.get(edge.sourceId);
    const target = nodes.get(edge.targetId);
    if (!source || !target || source.path === target.path) continue;
    const label =
      edge.kind === "IMPORTS"
        ? `Imports ${target.path}`
        : `Calls ${target.qualifiedName} in ${target.path}`;
    connections.set(edge.id, { source, label, ranges: edge.sourceRanges });
  }
  return connections;
}
