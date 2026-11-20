import { GraphCanvas, SelectionConnections } from "./graph-canvas";
import { recentChanges } from "@/features/activity/event-node";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { ChangeEvent, GraphNode } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { useResource } from "@/hooks/use-resource";
import { isNeighborhood } from "@/lib/contracts";
import { FileWorkspace } from "./file-workspace";
import { graphConnections } from "./graph-focus";
import { layoutNeighborhood } from "./layout";
import { sourceConnections } from "./source-connections";

export function GraphPanel({
  root,
  selectedId,
  selected,
  onSelect,
  onScope,
  onActivity,
  revision = 0,
  events = [],
  onOverview,
  details,
}: {
  details?: ReactNode;
  root: GraphNode;
  selectedId: string;
  selected: GraphNode | undefined;
  onSelect: (node: GraphNode) => void;
  onScope: (node: GraphNode) => void;
  onActivity: (node: GraphNode) => void;
  revision?: number;
  events?: ChangeEvent[];
  onOverview: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const [clearedFor, setClearedFor] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [sourceReveal, setSourceReveal] = useState(0);
  const [sourceEdgeId, setSourceEdgeId] = useState<string>();
  const [depth, setDepth] = useState(1);
  const fileView = root.kind === "file";
  const { data, error } = useResource(
    `/api/graph/nodes/${encodeURIComponent(root.id)}/neighborhood?depth=${depth}&limit=100`,
    isNeighborhood,
    revision,
  );
  const layout = useMemo(
    () =>
      data
        ? layoutNeighborhood(
            data,
            selectedId,
            recentChanges(events, now),
            fileView,
          )
        : { nodes: [], edges: [] },
    [data, selectedId, events, now, fileView],
  );
  const selectedInGraph = data?.nodes.find((node) => node.id === selectedId);
  const reading = selected ?? selectedInGraph;
  const connectionsById = useMemo(
    () => (fileView && data ? sourceConnections(data) : undefined),
    [fileView, data],
  );
  const connectionSites = useMemo(
    () =>
      [...(connectionsById ?? [])].flatMap(
        ([edgeId, { source, ranges, label }]) =>
          source.path === reading?.path
            ? ranges.map((range) => ({ ...range, edgeId, label }))
            : [],
      ),
    [connectionsById, reading?.path],
  );
  const sourceEdge = sourceEdgeId
    ? connectionsById?.get(sourceEdgeId)
    : undefined;
  const activeEdgeId =
    sourceEdge && sourceEdge.source.id === selectedId
      ? sourceEdgeId
      : undefined;
  const file =
    reading?.kind === "file"
      ? reading
      : data?.nodes.find(
          (node) => node.kind === "file" && node.path === reading?.path,
        );
  const graphSelection = fileView
    ? (selectedInGraph?.id ?? file?.id ?? null)
    : clearedFor === selectedId
      ? null
      : selectedId;
  const select = (node: GraphNode) => {
    setClearedFor(null);
    setDetailsFor(null);
    setSourceEdgeId(undefined);
    if (fileView && node.kind !== "file" && node.id === selectedId) {
      setSourceReveal((reveal) => reveal + 1);
    }
    onSelect(node);
  };
  const selectFromGraph = (id: string) => {
    const node = data?.nodes.find((node) => node.id === id);
    if (node) select(node);
  };
  const revealConnection = (id: string) => {
    const connection = connectionsById?.get(id);
    if (!connection) return;
    setDetailsFor(null);
    setSourceEdgeId(id);
    setSourceReveal((reveal) => reveal + 1);
    onSelect(connection.source);
  };
  const edges = fileView
    ? layout.edges.map((edge) => {
        const connection = connectionsById?.get(edge.id);
        if (!connection)
          return { ...edge, focusable: false, selectable: false };
        return {
          ...edge,
          selected: edge.id === activeEdgeId,
          selectable: false,
          ariaRole: "button",
          ariaLabel: `Show source connection from ${connection.source.path}. ${connection.label}`,
          domAttributes: {
            onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              revealConnection(edge.id);
            },
          },
        };
      })
    : layout.edges;
  const graph = error ? (
    <p role="alert">Graph unavailable. {error}</p>
  ) : !data ? (
    <p>Loading graph…</p>
  ) : (
    <GraphCanvas
      key={depth}
      nodes={layout.nodes}
      edges={edges}
      selectedId={graphSelection}
      selectedEdgeId={activeEdgeId ?? null}
      mode="symbols"
      details={details}
      hideSelectionDetails={fileView}
      onClear={() => {
        if (fileView) setSourceEdgeId(undefined);
        else setClearedFor(selectedId);
      }}
      onSelect={selectFromGraph}
      onEdgeSelect={fileView ? revealConnection : undefined}
    />
  );
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
      aria-label="Scoped graph"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold" title={root.path}>
            {root.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {fileView && "Graph scope · "}
            {data ? `${data.nodes.length} nodes` : "Loading…"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          <Button
            variant="outline"
            size="xs"
            disabled={depth === 0}
            onClick={() => setDepth((value) => value - 1)}
          >
            Collapse
          </Button>
          <span className="px-1 text-xs text-muted-foreground">
            Depth {depth}
          </span>
          <Button
            variant="outline"
            size="xs"
            disabled={depth === 5}
            onClick={() => setDepth((value) => value + 1)}
          >
            Expand
          </Button>
          <Button variant="outline" size="xs" onClick={onOverview}>
            Repository overview
          </Button>
        </div>
      </div>
      {data?.truncated && (
        <p className="text-sm text-warning">
          Neighborhood limited to 100 nodes. Use Focus neighborhood to explore a
          different scope.
        </p>
      )}
      {fileView ? (
        <FileWorkspace
          node={reading}
          file={file}
          graph={graph}
          connections={
            <SelectionConnections
              connections={graphConnections(
                layout.nodes,
                layout.edges,
                reading?.id ?? null,
              )}
              onSelect={selectFromGraph}
              symbols
            />
          }
          revision={revision}
          sourceConnections={
            data && {
              revision: data.revision,
              sites: connectionSites,
              activeEdgeId,
            }
          }
          sourceReveal={sourceReveal}
          detailsOpen={detailsFor === selectedId}
          onDetailsChange={(open) => setDetailsFor(open ? selectedId : null)}
          onSelect={select}
          onScope={onScope}
          onActivity={onActivity}
        />
      ) : (
        graph
      )}
    </section>
  );
}
