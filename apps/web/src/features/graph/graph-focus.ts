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
  selectedEdgeId: string | null = null,
) {
  const selected = nodes.some((node) => node.id === selectedId)
    ? selectedId
    : null;
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
  const edgeEndpoints = selectedEdge
    ? new Set([selectedEdge.source, selectedEdge.target])
    : null;
  const connections = graphConnections(nodes, edges, selected);
  const incoming = new Set(connections.incoming.map((node) => node.id));
  const outgoing = new Set(connections.outgoing.map((node) => node.id));
  // Non-selectable nodes are backdrops such as architecture layers.
  const backdrop = (node: Node) => node.selectable === false;
  return {
    nodes: nodes
      .filter(
        (node) =>
          backdrop(node) ||
          !selected ||
          !onlyConnections ||
          connections.ids.has(node.id),
      )
      .map((node) =>
        backdrop(node)
          ? node
          : {
              ...node,
              selected: node.id === selected,
              className: [
                node.className,
                node.id === selected ? "graph-selected" : "",
                (selected && !connections.ids.has(node.id)) ||
                (edgeEndpoints && !edgeEndpoints.has(node.id))
                  ? "graph-unrelated"
                  : "",
                selected && incoming.has(node.id) ? "graph-incoming" : "",
                selected && outgoing.has(node.id) ? "graph-outgoing" : "",
                edgeEndpoints && edgeEndpoints.has(node.id)
                  ? "graph-selected"
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
            },
      ),
    edges: edges
      .filter(
        (edge) =>
          !selected ||
          !onlyConnections ||
          edge.source === selected ||
          edge.target === selected,
      )
      .map((edge) => {
        const behaviour = edge.type === "behaviour";
        const uncertain =
          behaviour && edge.className === "graph-edge-uncertain";
        const archStatus = edge.data?.changeStatus;
        const archUncommitted = Boolean(edge.data?.uncommitted);
        const isSelectedEdge = selectedEdge?.id === edge.id;
        const active =
          isSelectedEdge ||
          Boolean(
            selected && (edge.source === selected || edge.target === selected),
          );
        const hasSelection = Boolean(selected || selectedEdge);
        const color = uncertain
          ? "var(--warning)"
          : archStatus === "new"
            ? "var(--success)"
            : archStatus === "changed"
              ? "var(--warning)"
              : isSelectedEdge
                ? "var(--primary)"
                : active
                  ? edge.source === selected
                    ? "var(--primary)"
                    : "var(--chart-1)"
                  : "var(--muted-foreground)";
        return {
          ...edge,
          className: [
            edge.className,
            behaviour && "graph-behaviour-edge",
            hasSelection && !active
              ? "graph-edge-unrelated"
              : active
                ? "graph-edge-active"
                : "",
          ]
            .filter(Boolean)
            .join(" "),
          label: hasSelection && !active && !behaviour ? undefined : edge.label,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            width: 20,
            height: 20,
          },
          style: {
            ...edge.style,
            stroke: color,
            strokeWidth: isSelectedEdge
              ? 3.2
              : archUncommitted
                ? 2.8
                : behaviour
                  ? active
                    ? 2.6
                    : 2
                  : active
                    ? 3
                    : 1.75,
          },
          labelStyle: {
            fill: uncertain
              ? "var(--warning)"
              : archStatus === "new"
                ? "var(--success)"
                : archStatus === "changed"
                  ? "var(--warning)"
                  : active || behaviour
                    ? "var(--foreground)"
                    : "var(--muted-foreground)",
            fontSize: behaviour ? 13 : 12,
            fontWeight: behaviour ? 600 : 500,
          },
          labelBgStyle: { fill: "var(--background)", fillOpacity: 1 },
          labelBgPadding: [7, 4] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
  };
}
