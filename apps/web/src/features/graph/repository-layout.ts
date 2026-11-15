import dagre from "@dagrejs/dagre";
import { MarkerType, Position, type Node, type Edge } from "@xyflow/react";
import type { GraphNode, RepositoryGraph } from "@mycel/shared";

export function folderOf(path: string, depth: number): string {
  const directories = path.split("/").slice(0, -1);
  return directories.slice(0, depth).join("/") || "(root)";
}
export function groupRepository(graph: RepositoryGraph, depth: number) {
  const groups = new Map<string, GraphNode[]>();
  const folders = new Map<string, string>();
  for (const file of graph.files) {
    const folder = folderOf(file.path, depth);
    folders.set(file.id, folder);
    const files = groups.get(folder) ?? [];
    files.push(file);
    groups.set(folder, files);
  }
  const connections = new Map<
    string,
    { source: string; target: string; count: number }
  >();
  for (const edge of graph.dependencies) {
    const source = folders.get(edge.sourceId),
      target = folders.get(edge.targetId);
    if (source === undefined || target === undefined || source === target)
      continue;
    const key = JSON.stringify([source, target]);
    const previous = connections.get(key);
    connections.set(key, { source, target, count: (previous?.count ?? 0) + 1 });
  }
  return { groups, connections: [...connections.values()] };
}
export function layoutRepositoryGroups(
  graph: RepositoryGraph,
  depth: number,
  selected: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const { groups, connections } = groupRepository(graph, depth);
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: "LR", nodesep: 45, ranksep: 110 });
  for (const folder of groups.keys())
    layout.setNode(folder, { width: 250, height: 80 });
  for (const edge of connections) layout.setEdge(edge.source, edge.target);
  dagre.layout(layout);
  return {
    nodes: [...groups].map(([folder, files]) => {
      const position = layout.node(folder);
      return {
        id: folder,
        position: { x: position.x - 125, y: position.y - 40 },
        data: {
          label: `${folder} · ${files.length} ${files.length === 1 ? "file" : "files"}`,
        },
        selected: folder === selected,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: "graph-node graph-node-file",
        style: { width: 250, minHeight: 80 },
      };
    }),
    edges: connections.map((edge) => ({
      id: JSON.stringify([edge.source, edge.target]),
      source: edge.source,
      target: edge.target,
      label: `${edge.count} ${edge.count === 1 ? "import" : "imports"}`,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "var(--primary)" },
    })),
  };
}
