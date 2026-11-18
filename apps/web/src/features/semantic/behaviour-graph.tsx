import { useMemo, useState, useSyncExternalStore } from "react";
import type {
  BehaviourTrace,
  SemanticEntity,
  SemanticSource,
} from "@mycel/shared";
import { Button } from "@/components/ui/button";
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

export default function BehaviourGraph({
  traces,
  members,
  revision,
}: {
  traces: BehaviourTrace[];
  members: SemanticEntity[];
  revision: number;
}) {
  const [showCalls, setShowCalls] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const narrow = useSyncExternalStore(subscribeToWidth, isNarrowScreen);
  const graph = useMemo(
    () => layoutBehaviour(traces, showCalls, narrow ? "TB" : "LR", members),
    [traces, showCalls, narrow, members],
  );
  return (
    <section aria-label="Behaviour graph" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Behaviour graph</h3>
        {graph.nodes.length > 0 && (
          <Button
            variant={showCalls ? "secondary" : "outline"}
            size="sm"
            aria-pressed={showCalls}
            onClick={() => setShowCalls((value) => !value)}
          >
            Show call steps
          </Button>
        )}
      </div>
      {graph.nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No supported UI event paths found.
        </p>
      ) : (
        <div className="flex lg:h-[min(68dvh,52rem)] lg:min-h-[28rem]">
          <GraphCanvas
            key={`${showCalls}:${revision}:${narrow}`}
            mode="behaviour"
            initialFocusId={showCalls ? traces[0]?.rootId : undefined}
            nodes={graph.nodes}
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
