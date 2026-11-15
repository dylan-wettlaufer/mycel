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
}: {
  root: GraphNode;
  selected: GraphNode;
  onSelect: (node: GraphNode) => void;
  revision?: number;
  events?: ChangeEvent[];
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
    <section className="space-y-3" aria-label="Scoped graph">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-semibold">Graph</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={depth === 0}
          onClick={() => setDepth((value) => value - 1)}
        >
          Collapse
        </Button>
        <span className="text-sm">Depth {depth}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={depth === 5}
          onClick={() => setDepth((value) => value + 1)}
        >
          Expand
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Neighborhood of {root.name} · {data?.nodes.length ?? 0} nodes · maximum
        100
      </p>
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
