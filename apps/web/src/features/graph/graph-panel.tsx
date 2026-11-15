import { GraphCanvas } from "./graph-canvas";
import { recentChanges } from "@/features/activity/event-node";
import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, GraphNode } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { useResource } from "@/hooks/use-resource";
import { isNeighborhood } from "@/lib/contracts";
import { layoutNeighborhood } from "./layout";

export function GraphPanel({
  root,
  selected,
  onSelect,
  revision = 0,
  events = [],
  onOverview,
}: {
  root: GraphNode;
  selected: GraphNode;
  onSelect: (node: GraphNode) => void;
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
  const [depth, setDepth] = useState(1);
  const { data, error } = useResource(
    `/api/graph/nodes/${encodeURIComponent(root.id)}/neighborhood?depth=${depth}&limit=100`,
    isNeighborhood,
    revision,
  );
  const layout = useMemo(
    () =>
      data
        ? layoutNeighborhood(data, selected.id, recentChanges(events, now))
        : { nodes: [], edges: [] },
    [data, selected.id, events, now],
  );
  return (
    <section className="space-y-2" aria-label="Scoped graph">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold" title={root.path}>
            {root.name}
          </h2>
          <p className="text-xs text-muted-foreground">
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
      {error ? (
        <p role="alert">Graph unavailable. {error}</p>
      ) : !data ? (
        <p>Loading graph…</p>
      ) : (
        <>
          {data.truncated && (
            <p className="text-sm text-warning">
              Neighborhood limited to 100 nodes. Select a node to explore a
              different scope.
            </p>
          )}
          <GraphCanvas
            key={`${root.id}:${depth}`}
            nodes={layout.nodes}
            edges={layout.edges}
            selectedId={clearedFor === selected.id ? null : selected.id}
            symbols
            onClear={() => setClearedFor(selected.id)}
            onSelect={(id) => {
              setClearedFor(null);
              const node = data.nodes.find((node) => node.id === id);
              if (node) onSelect(node);
            }}
          />
        </>
      )}
    </section>
  );
}
