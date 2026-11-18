import {
  memo,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  BehaviourTrace,
  SemanticEntity,
  SemanticSource,
} from "@mycel/shared";
import { GraphCanvas } from "@/features/graph/graph-canvas";
import { layoutBehaviour, relationshipLabels } from "./behaviour-layout";

const narrowScreen = "(width < 40rem)";

function subscribeToWidth(onChange: () => void) {
  const screen = window.matchMedia(narrowScreen);
  screen.addEventListener("change", onChange);
  return () => screen.removeEventListener("change", onChange);
}

function isNarrowScreen() {
  return window.matchMedia(narrowScreen).matches;
}

function SourceLocations({ sources }: { sources: SemanticSource[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {sources.map(({ nodeId, path, range }) => (
        <li key={JSON.stringify([nodeId, path, range.start, range.end])}>
          <code
            className="break-all text-xs text-muted-foreground"
            title={`${path}:${range.startLine}:${range.startColumn}`}
          >
            {path}:{range.startLine}
          </code>
        </li>
      ))}
    </ul>
  );
}

function SelectionEvidence({
  graph,
  id,
}: {
  graph: ReturnType<typeof layoutBehaviour>;
  id: string;
}) {
  const entity = graph.entities.get(id);
  if (!entity) return null;
  const links = graph.edges.filter(
    (edge) => edge.source === id || edge.target === id,
  );
  const notices = graph.notices.get(id);
  return (
    <>
      {notices && (
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[...notices].map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}
      <section>
        <h4 className="text-sm font-medium">Source locations</h4>
        <SourceLocations sources={entity.sources} />
      </section>
      {links.map((edge) => (
        <section key={edge.id} className="space-y-2 border-t pt-3">
          <h4 className="break-all text-sm font-medium">
            {edge.source === id
              ? `To ${graph.entities.get(edge.target)?.name}`
              : `From ${graph.entities.get(edge.source)?.name}`}
          </h4>
          {edge.data.paths.map((path) => (
            <ol
              key={JSON.stringify(
                path.map(({ relationship }) => relationship.id),
              )}
              className="space-y-3 border-l pl-3"
            >
              {path.map(({ toId, relationship }) => (
                <li key={relationship.id}>
                  <span className="text-xs text-muted-foreground">
                    {relationshipLabels[relationship.kind]}{" "}
                  </span>
                  <code className="break-all text-xs">
                    {graph.entities.get(toId)?.name}
                  </code>
                  <SourceLocations sources={relationship.sources} />
                </li>
              ))}
            </ol>
          ))}
        </section>
      ))}
    </>
  );
}

function BehaviourGraph({
  traces,
  members,
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
  return (
    <section aria-label="Behaviour graph" className="min-w-0 space-y-3">
      <h3 className="text-base font-semibold">Behaviour graph</h3>
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
            onClear={() => setSelectedId(null)}
            details={
              selectedId && <SelectionEvidence graph={graph} id={selectedId} />
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
