import { useState } from "react";
import type {
  AgentProposal,
  BehaviourPath,
  BehaviourTrace,
  PartWalkthrough,
  SemanticEntity,
  SemanticSource,
} from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { SourcePanel } from "@/features/source/source-panel";
import { describeBehaviour } from "@/features/semantic/behaviour-presentation";
import { useResource } from "@/hooks/use-resource";
import { isRecord, isSourceRange } from "@/lib/contracts";

function isEntity(value: unknown): value is SemanticEntity {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.kind === "string" &&
    isRecord(value.attributes) &&
    Object.values(value.attributes).every(
      (attribute) => typeof attribute === "string",
    ) &&
    isRecord(value.provenance) &&
    typeof value.provenance.rule === "string" &&
    Array.isArray(value.sources) &&
    value.sources.every(
      (source: unknown) =>
        isRecord(source) &&
        typeof source.path === "string" &&
        typeof source.nodeId === "string" &&
        isSourceRange(source.range),
    )
  );
}

function isProposal(value: unknown): value is AgentProposal {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.agent === "string" &&
    typeof value.label === "string" &&
    typeof value.path === "string" &&
    typeof value.line === "number" &&
    typeof value.sourceValid === "boolean" &&
    (value.calls === undefined || typeof value.calls === "string") &&
    (value.callSupported === undefined ||
      typeof value.callSupported === "boolean")
  );
}

function isWalkthrough(value: unknown): value is PartWalkthrough {
  return (
    isRecord(value) &&
    typeof value.revision === "number" &&
    typeof value.truncated === "boolean" &&
    Array.isArray(value.entries) &&
    value.entries.every(isEntity) &&
    Array.isArray(value.proposals) &&
    value.proposals.every(isProposal) &&
    (value.proposalError === undefined ||
      typeof value.proposalError === "string")
  );
}

function isTrace(value: unknown): value is BehaviourTrace {
  return (
    isRecord(value) &&
    typeof value.revision === "number" &&
    typeof value.truncated === "boolean" &&
    Array.isArray(value.entities) &&
    value.entities.every(isEntity) &&
    Array.isArray(value.paths) &&
    value.paths.every(
      (path: unknown) =>
        isRecord(path) &&
        typeof path.end === "string" &&
        Array.isArray(path.entityIds) &&
        path.entityIds.every((id: unknown) => typeof id === "string") &&
        (path.boundary === undefined ||
          (isRecord(path.boundary) &&
            typeof path.boundary.message === "string")) &&
        Array.isArray(path.hops) &&
        path.hops.every(
          (hop: unknown) =>
            isRecord(hop) &&
            typeof hop.fromId === "string" &&
            typeof hop.toId === "string" &&
            isRecord(hop.relationship) &&
            typeof hop.relationship.kind === "string",
        ),
    )
  );
}

const endLabels: Record<BehaviourPath["end"], string> = {
  "data-access": "Reached a persistence operation.",
  unresolved: "Tracing stopped at an unsupported step.",
  "no-supported-calls": "No further supported calls.",
  "no-supported-callers": "No further supported callers.",
  "depth-limit": "Tracing reached the depth limit.",
  cycle: "Tracing reached a call cycle.",
  "work-limit": "Tracing reached the work limit.",
};

export function PartWalkthroughPanel({
  partId,
  component,
  revision,
}: {
  partId: string;
  component?: string | undefined;
  revision: number;
}) {
  const [open, setOpen] = useState(false);
  const [entryId, setEntryId] = useState<string>();
  const [source, setSource] = useState<{
    mapping: SemanticSource;
    revision: number;
  }>();
  const details = useResource(
    open
      ? `/api/architecture/parts/${encodeURIComponent(partId)}/walkthrough${component ? `?component=${encodeURIComponent(component)}` : ""}`
      : null,
    isWalkthrough,
    revision,
  );
  const activeEntry = details.data?.entries.find(({ id }) => id === entryId);
  const trace = useResource(
    open && activeEntry
      ? `/api/graph/behaviour/${encodeURIComponent(activeEntry.id)}`
      : null,
    isTrace,
    details.data?.revision,
  );
  // A trace and its source links must describe the same commit.
  const currentTrace =
    trace.data?.revision === details.data?.revision ? trace.data : undefined;
  const entities = new Map(
    currentTrace?.entities.map((entity) => [entity.id, entity]),
  );
  const descriptions = currentTrace
    ? describeBehaviour(entities, currentTrace.paths, currentTrace.entities)
    : undefined;

  return (
    <section aria-label="Flow walkthrough" className="space-y-3 border-b p-4">
      <Button
        size="sm"
        variant="outline"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setEntryId(undefined);
          setSource(undefined);
        }}
      >
        {open ? "Close walkthrough" : "Walk through a flow"}
      </Button>
      {open && (
        <>
          {details.loading && (
            <p className="text-xs text-muted-foreground">
              Loading flow entries…
            </p>
          )}
          {details.error && (
            <div className="space-y-1">
              <p role="alert" className="text-sm">
                Flow entries unavailable.
              </p>
              <Button size="xs" variant="outline" onClick={details.retry}>
                Retry entries
              </Button>
            </div>
          )}
          {details.data && (
            <>
              {details.data.entries.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No supported UI event bindings in this part.
                </p>
              )}
              {details.data.entries.length > 0 && (
                <ul aria-label="Flow entries" className="space-y-1">
                  {details.data.entries.map((entry) => {
                    const site = entry.sources[0];
                    return (
                      <li key={entry.id}>
                        <Button
                          size="sm"
                          className="h-auto max-w-full text-left break-all whitespace-normal"
                          variant={entry.id === entryId ? "secondary" : "ghost"}
                          aria-pressed={entry.id === entryId}
                          onClick={() => {
                            setEntryId(entry.id);
                            setSource(undefined);
                          }}
                        >
                          Trace {entry.name}
                          {site && ` · ${site.path}:${site.range.startLine}`}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {details.data.truncated && (
                <p className="text-xs text-muted-foreground">
                  Showing the first 100 flow entries.
                </p>
              )}
              {entryId && !activeEntry && !details.loading && (
                <p role="status" className="text-sm">
                  The entry moved or was removed. Select a current entry.
                </p>
              )}
              {source ? (
                <div className="space-y-2">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setSource(undefined)}
                  >
                    Back to flow
                  </Button>
                  <SourcePanel
                    node={source.mapping}
                    expectedRevision={source.revision}
                  />
                </div>
              ) : (
                activeEntry && (
                  <>
                    {trace.loading && (
                      <p className="text-xs text-muted-foreground">
                        Loading trace…
                      </p>
                    )}
                    {trace.error && (
                      <div className="space-y-1">
                        <p role="alert" className="text-sm">
                          Trace unavailable.
                        </p>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={trace.retry}
                        >
                          Retry trace
                        </Button>
                      </div>
                    )}
                    {!currentTrace && trace.data && !trace.loading && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={details.retry}
                      >
                        Refresh flow
                      </Button>
                    )}
                    {currentTrace?.paths.map((path, pathIndex) => (
                      <section
                        key={pathIndex}
                        aria-label={`Trace path ${pathIndex + 1}`}
                        className="space-y-2 rounded-md border p-3"
                      >
                        {currentTrace.paths.length > 1 && (
                          <h4 className="text-sm font-semibold">
                            Path {pathIndex + 1}
                          </h4>
                        )}
                        <ol className="space-y-2">
                          {path.entityIds.map((id, stepIndex) => {
                            const step = entities.get(id);
                            const title =
                              descriptions?.get(id)?.title ?? step?.name;
                            if (!step) return null;
                            const mapping = step.sources[0];
                            return (
                              <li
                                key={`${id}:${stepIndex}`}
                                className="flex flex-wrap items-center justify-between gap-1"
                              >
                                <span className="text-sm">{title}</span>
                                {mapping && (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    aria-label={`View source for ${title}`}
                                    onClick={() =>
                                      setSource({
                                        mapping,
                                        revision: currentTrace.revision,
                                      })
                                    }
                                  >
                                    Source
                                  </Button>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                        <p className="text-xs text-muted-foreground">
                          {endLabels[path.end]} {path.boundary?.message}
                        </p>
                      </section>
                    ))}
                    {currentTrace?.truncated && (
                      <p className="text-xs text-muted-foreground">
                        Some trace paths were omitted.
                      </p>
                    )}
                  </>
                )
              )}
              <AgentProposals data={details.data} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function AgentProposals({ data }: { data: PartWalkthrough }) {
  if (!data.proposalError && !data.proposals.length) return null;
  return (
    <section aria-label="Agent proposals" className="space-y-2">
      <h4 className="text-sm font-semibold">Agent proposals</h4>
      {data.proposalError && (
        <p role="alert" className="text-xs">
          {data.proposalError}
        </p>
      )}
      <ul className="space-y-2 text-xs">
        {data.proposals.map((proposal) => (
          <li key={proposal.id} className="space-y-1">
            <p>
              <strong>{proposal.label}</strong> · Proposed by {proposal.agent}
            </p>
            <p className="break-words text-muted-foreground">
              {proposal.path}:{proposal.line} ·{" "}
              {proposal.sourceValid
                ? "Source matched"
                : "Source unavailable in this part"}
            </p>
            {proposal.calls && (
              <p>
                {proposal.callSupported
                  ? "Supported call to"
                  : "Unsupported call claim to"}{" "}
                {proposal.calls}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
