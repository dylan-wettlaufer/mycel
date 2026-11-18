import {
  memo,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { BehaviourTrace, SemanticEntity } from "@mycel/shared";
import { GraphCanvas } from "@/features/graph/graph-canvas";
import { BehaviourDetails, BehaviourEmptyState } from "./behaviour-details";
import type { BehaviourConnection } from "./behaviour-details-data";
import { layoutBehaviour } from "./behaviour-layout";

const wideScreen = "(width >= 75rem)";

function subscribeToWidth(onChange: () => void) {
  const screen = window.matchMedia(wideScreen);
  screen.addEventListener("change", onChange);
  return () => screen.removeEventListener("change", onChange);
}

function isWideScreen() {
  return window.matchMedia(wideScreen).matches;
}

function BehaviourGraph({
  traces,
  members,
  revision,
}: {
  traces: BehaviourTrace[];
  members: SemanticEntity[];
  revision: number;
}) {
  const [{ expanded, anchorId, fitRequest }, setExpansion] = useState<{
    expanded: Set<string>;
    anchorId?: string;
    fitRequest: number;
  }>(() => ({ expanded: new Set(), fitRequest: 0 }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ id: string } | null>(null);
  const wide = useSyncExternalStore(subscribeToWidth, isWideScreen);
  const graph = useMemo(
    () => layoutBehaviour(traces, expanded, wide ? "LR" : "TB", members),
    [traces, expanded, wide, members],
  );
  const toggle = useCallback((id: string) => {
    setExpansion((previous) => {
      const next = new Set(previous.expanded);
      if (!next.delete(id)) next.add(id);
      return {
        expanded: next,
        anchorId: id,
        fitRequest: previous.fitRequest + 1,
      };
    });
  }, []);
  function selectNode(id: string) {
    setSelectedId(id);
    setReveal({ id });
  }
  function selectConnection({ id, revealFrom }: BehaviourConnection) {
    if (revealFrom !== undefined) {
      setExpansion((previous) => ({
        expanded: new Set([...previous.expanded, revealFrom]),
        anchorId: revealFrom,
        fitRequest: previous.fitRequest + 1,
      }));
    }
    selectNode(id);
  }
  const nodes = useMemo(
    () =>
      graph.nodes.map((node) =>
        graph.expandable.has(node.id)
          ? {
              ...node,
              data: {
                ...node.data,
                expansion: {
                  expanded: expanded.has(node.id),
                  onToggle: toggle,
                },
              },
            }
          : node,
      ),
    [graph.nodes, graph.expandable, expanded, toggle],
  );
  if (selectedId && !nodes.some((node) => node.id === selectedId)) {
    setSelectedId(anchorId && graph.expandable.has(anchorId) ? anchorId : null);
  }
  const clearSelection = () => {
    setSelectedId(null);
    setReveal(null);
  };
  return (
    <section
      aria-label="Behaviour graph"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
    >
      <div className="flex min-h-6 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold">Behaviour graph</h3>
        {nodes.length > 0 && !selectedId && <BehaviourEmptyState />}
      </div>
      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No supported UI event paths found.
        </p>
      ) : (
        <div className="flex min-h-56 flex-1">
          <GraphCanvas
            mode="behaviour"
            layoutAnchorId={anchorId ?? nodes[0]?.id}
            behaviourView={{
              rootId: nodes[0]!.id,
              wide,
              fitRequest,
              hasExpandedSteps: expanded.size > 0,
              reveal,
            }}
            nodes={nodes}
            edges={graph.edges}
            selectedId={selectedId}
            onSelect={selectNode}
            onClear={clearSelection}
            sidePanel={
              selectedId && (
                <BehaviourDetails
                  graph={graph}
                  selectedId={selectedId}
                  members={members}
                  revision={revision}
                  onSelect={selectConnection}
                  onClear={clearSelection}
                />
              )
            }
          />
        </div>
      )}
    </section>
  );
}

// Live activity can refetch the same snapshot while React Flow measures nodes.
export default memo(
  BehaviourGraph,
  (before, after) => before.revision === after.revision,
);
