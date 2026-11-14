import { useMemo, useState } from "react";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphNode } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { useResource } from "@/hooks/use-resource";
import { isNeighborhood } from "@/lib/contracts";
import { layoutNeighborhood } from "./layout";

export function GraphPanel({
  root,
  selected,
  onSelect,
  revision = 0,
}: {
  root: GraphNode;
  selected: GraphNode;
  onSelect: (node: GraphNode) => void;
  revision?: number;
}) {
  const [depth, setDepth] = useState(1);
  const { data, error } = useResource(
    `/api/graph/nodes/${encodeURIComponent(root.id)}/neighborhood?depth=${depth}&limit=100`,
    isNeighborhood,
    revision,
  );
  const layout = useMemo(
    () =>
      data ? layoutNeighborhood(data, selected.id) : { nodes: [], edges: [] },
    [data, selected.id],
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
          <div className="h-[540px] min-h-80 overflow-hidden rounded-lg border bg-card">
            <ReactFlow
              key={`${root.id}:${depth}`}
              nodes={layout.nodes}
              edges={layout.edges}
              fitView
              colorMode="dark"
              nodesDraggable={false}
              nodesConnectable={false}
              onNodeClick={(_, node) => {
                const selected = data.nodes.find((item) => item.id === node.id);
                if (selected) onSelect(selected);
              }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <p className="text-xs text-muted-foreground">
            Select a node for details. Dashed edges contain symbols; arrows
            follow calls and imports.
          </p>
        </>
      )}
    </section>
  );
}
