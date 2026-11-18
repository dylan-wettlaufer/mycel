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

const narrowScreen = "(width < 40rem)";

function subscribeToWidth(onChange: () => void) {
  const screen = window.matchMedia(narrowScreen);
  screen.addEventListener("change", onChange);
  return () => screen.removeEventListener("change", onChange);
}

function isNarrowScreen() {
  return window.matchMedia(narrowScreen).matches;
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
  const [{ expanded, anchorId, actionId }, setExpansion] = useState<{
    expanded: Set<string>;
    anchorId?: string;
    actionId: number;
  }>(() => ({ expanded: new Set(), actionId: 0 }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const narrow = useSyncExternalStore(subscribeToWidth, isNarrowScreen);
  const graph = useMemo(
    () => layoutBehaviour(traces, expanded, narrow ? "TB" : "LR", members),
    [traces, expanded, narrow, members],
  );
  const toggle = useCallback((id: string) => {
    setExpansion((previous) => {
      const next = new Set(previous.expanded);
      if (!next.delete(id)) next.add(id);
      return { expanded: next, anchorId: id, actionId: previous.actionId + 1 };
    });
  }, []);
  function selectConnection({ id, revealFrom }: BehaviourConnection) {
    if (revealFrom !== undefined) {
      setExpansion((previous) => ({
        expanded: new Set([...previous.expanded, revealFrom]),
        anchorId: revealFrom,
        actionId: previous.actionId + 1,
      }));
    }
    setSelectedId(id);
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
  const clearSelection = () => setSelectedId(null);
  return (
    <section aria-label="Behaviour graph" className="min-w-0 space-y-3">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold">Behaviour graph</h3>
        {nodes.length > 0 && !selectedId && <BehaviourEmptyState />}
      </div>
      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No supported UI event paths found.
        </p>
      ) : (
        <div className="flex lg:h-[min(68dvh,52rem)] lg:min-h-[28rem]">
          <GraphCanvas
            key={String(narrow)}
            mode="behaviour"
            layoutAnchorId={anchorId}
            fitRequest={
              anchorId && expanded.has(anchorId) ? actionId : undefined
            }
            nodes={nodes}
            edges={graph.edges}
            selectedId={selectedId}
            onSelect={setSelectedId}
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
