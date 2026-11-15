import { MarkerType, type Edge, type Node } from "@xyflow/react";

/** Trace direct links in either direction, preserving the original edge direction. */
export function graphConnections(
  nodes: Node[],
  edges: Edge[],
  selectedId: string | null,
) {
  const incoming = edges.filter((edge) => edge.target === selectedId);
  const outgoing = edges.filter((edge) => edge.source === selectedId);
  const ids = new Set([
    ...(selectedId ? [selectedId] : []),
    ...incoming.map((edge) => edge.source),
    ...outgoing.map((edge) => edge.target),
  ]);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const linked = (edges: Edge[], endpoint: "source" | "target") =>
    [...new Set(edges.map((edge) => edge[endpoint]))]
      .filter((id) => id !== selectedId)
      .flatMap((id) => {
        const node = byId.get(id);
        return node ? [node] : [];
      });
  return {
    ids,
    incoming: linked(incoming, "source"),
    outgoing: linked(outgoing, "target"),
  };
}
export function focusGraph(
  nodes: Node[],
  edges: Edge[],
  selectedId: string | null,
  onlyConnections: boolean,
) {
  const selected = nodes.some((node) => node.id === selectedId)
    ? selectedId
    : null;
  const connections = graphConnections(nodes, edges, selected);
  const incoming = new Set(connections.incoming.map((node) => node.id));
  const outgoing = new Set(connections.outgoing.map((node) => node.id));
  return {
    nodes: nodes
      .filter(
        (node) => !selected || !onlyConnections || connections.ids.has(node.id),
      )
      .map((node) => ({
        ...node,
        selected: node.id === selected,
        className: [
          node.className,
          node.id === selected ? "graph-selected" : "",
          selected && !connections.ids.has(node.id) ? "graph-unrelated" : "",
          selected && incoming.has(node.id) ? "graph-incoming" : "",
          selected && outgoing.has(node.id) ? "graph-outgoing" : "",
        ]
          .filter(Boolean)
          .join(" "),
      })),
    edges: edges
      .filter(
        (edge) =>
          !selected ||
          !onlyConnections ||
          edge.source === selected ||
          edge.target === selected,
      )
      .map((edge) => {
        const active =
          selected && (edge.source === selected || edge.target === selected);
        const color = active
          ? edge.source === selected
            ? "var(--primary)"
            : "var(--chart-1)"
          : "var(--muted-foreground)";
        return {
          ...edge,
          className:
            selected && !active
              ? "graph-edge-unrelated"
              : active
                ? "graph-edge-active"
                : "",
          label: selected && !active ? undefined : edge.label,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            width: 20,
            height: 20,
          },
          style: {
            ...edge.style,
            stroke: color,
            strokeWidth: active ? 3 : 1.75,
          },
          labelStyle: {
            fill: active ? "var(--foreground)" : "var(--muted-foreground)",
            fontSize: 12,
            fontWeight: 500,
          },
          labelBgStyle: { fill: "var(--background)", fillOpacity: 1 },
          labelBgPadding: [7, 4] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
  };
}
