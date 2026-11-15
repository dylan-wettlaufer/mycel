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
  layout.setGraph({ rankdir: "LR", nodesep: 100, ranksep: 160 });
  for (const folder of groups.keys())
    layout.setNode(folder, { width: 190, height: 100 });
  for (const edge of connections) layout.setEdge(edge.source, edge.target);
  dagre.layout(layout);
  return {
    nodes: [...groups].map(([folder, files]) => {
      const position = layout.node(folder);
      return {
        id: folder,
        position: { x: position.x - 95, y: position.y - 50 },
        type: "code",
        ariaLabel: `Folder ${folder}, ${files.length} files`,
        data: {
          kind: "folder",
          name: folder.split("/").at(-1),
          context: folder,
          detail: `${files.length} ${files.length === 1 ? "file" : "files"}`,
          label: `${folder} · ${files.length} ${files.length === 1 ? "file" : "files"}`,
        },
        selected: folder === selected,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: "graph-node graph-node-file",
        style: { width: 190, height: 100 },
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

/** Keep direct external dependencies/dependents so a folder never looks isolated. */
export function fileScope(
  graph: RepositoryGraph,
  folder?: string,
): RepositoryGraph {
  if (!folder) return graph;
  const scoped = new Set(
    graph.files
      .filter((file) =>
        folder === "(root)"
          ? !file.path.includes("/")
          : file.path.startsWith(`${folder}/`),
      )
      .map((file) => file.id),
  );
  const dependencies = graph.dependencies.filter(
    (edge) => scoped.has(edge.sourceId) || scoped.has(edge.targetId),
  );
  const included = new Set([
    ...scoped,
    ...dependencies.flatMap((edge) => [edge.sourceId, edge.targetId]),
  ]);
  return {
    ...graph,
    files: graph.files.filter((file) => included.has(file.id)),
    dependencies,
  };
}
export function layoutFileDependencies(graph: RepositoryGraph): {
  nodes: Node[];
  edges: Edge[];
} {
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: "LR", nodesep: 100, ranksep: 180 });
  for (const file of graph.files)
    layout.setNode(file.id, { width: 240, height: 100 });
  for (const edge of graph.dependencies)
    layout.setEdge(edge.sourceId, edge.targetId);
  dagre.layout(layout);
  return {
    nodes: graph.files.map((file) => {
      const position = layout.node(file.id);
      return {
        id: file.id,
        position: { x: position.x - 120, y: position.y - 50 },
        type: "code",
        ariaLabel: `File ${file.path}`,
        data: {
          label: file.path,
          name: file.name ?? file.path.split("/").at(-1),
          context: file.path.split("/").slice(0, -1).join("/") || "(root)",
          kind: "file",
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: "graph-node graph-node-file",
        style: { width: 240, height: 100 },
      };
    }),
    edges: graph.dependencies.map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      label: "imports",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "var(--primary)" },
    })),
  };
}
