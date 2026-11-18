import type { SemanticEntity, SemanticSource } from "@mycel/shared";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode,
  MousePointer2,
  X,
} from "lucide-react";
import { Collapsible, Dialog } from "radix-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { operationKindLabel } from "@/features/graph/graph-node";
import { SourcePanel } from "@/features/source/source-panel";
import { relationshipLabels } from "./behaviour-layout";
import {
  getBehaviourDetails,
  type BehaviourConnection,
  type BehaviourLayout,
} from "./behaviour-details-data";

type Location = Pick<SemanticSource, "path" | "range">;

function sourceLabel({ path, range }: Location) {
  return `${path}:${range.startLine}`;
}

function SourceLink({
  source,
  revision,
  owner,
}: {
  source: Location;
  revision: number;
  owner?: string | undefined;
}) {
  const label = sourceLabel(source);
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full min-w-0 justify-start gap-2 whitespace-normal px-2 py-1 text-left"
          aria-label={`Open source at ${label}${owner ? ` in ${owner}` : ""}`}
          title={`Open source at ${label}:${source.range.startColumn}`}
        >
          <FileCode aria-hidden className="self-start text-muted-foreground" />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {owner && <code className="block text-xs">{owner}</code>}
            <code className="block text-xs font-normal text-muted-foreground">
              {label}
            </code>
          </span>
          <ExternalLink aria-hidden className="size-3 text-muted-foreground" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl -translate-1/2 overflow-y-auto rounded-lg border bg-card p-4 shadow-lg"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <Dialog.Title className="text-base font-semibold">
              Source viewer
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm">
                Close source
              </Button>
            </Dialog.Close>
          </div>
          <SourcePanel node={source} revision={revision} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function sourceKey({ nodeId, path, range }: SemanticSource) {
  return JSON.stringify([nodeId, path, range.start, range.end]);
}

export function BehaviourDetails({
  graph,
  selectedId,
  members,
  revision,
  onSelect,
  onClear,
}: {
  graph: BehaviourLayout;
  selectedId: string;
  members: SemanticEntity[];
  revision: number;
  onSelect: (connection: BehaviourConnection) => void;
  onClear: () => void;
}) {
  const details = getBehaviourDetails(graph, selectedId, members);
  const summary = graph.presentation.get(selectedId);
  if (!details || !summary) return null;
  const notices = graph.notices.get(selectedId);

  return (
    <aside
      aria-label="Selection details"
      className="flex max-h-[min(60dvh,36rem)] min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-lg border bg-card lg:max-h-none lg:w-[310px] lg:max-w-[40%]"
    >
      <ScrollArea
        key={details.entity.id}
        type="always"
        className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!"
      >
        <div className="divide-y">
          <section
            aria-label="Overview"
            className="space-y-1.5 px-3.5 pt-2.5 pb-3"
          >
            <div className="flex items-start justify-between gap-2">
              <h4 className="py-1 text-lg leading-tight font-semibold [overflow-wrap:anywhere]">
                {summary.title}
              </h4>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Clear selection"
                title="Clear selection"
                onClick={onClear}
              >
                <X aria-hidden />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">
                {operationKindLabel(summary.kind)}
              </Badge>
              <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {details.entity.name}
              </p>
              {details.entity.provenance.kind === "heuristic" && (
                <Badge variant="outline">Inferred</Badge>
              )}
              {details.entity.attributes.binding === "unresolved" && (
                <Badge variant="outline" className="text-warning">
                  Unresolved binding
                </Badge>
              )}
            </div>
            <p className="text-sm [overflow-wrap:anywhere]">
              {summary.description}
            </p>
            {notices && (
              <ul className="space-y-1 text-xs text-warning">
                {[...notices].map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Connections" className="space-y-1.5 px-3.5 py-3">
            <h4 className="text-sm font-semibold">Connections</h4>
            {details.groups.map(({ title, connections }, index) => (
              <div key={title}>
                <h5 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {index < 2 && (
                    <i
                      aria-hidden
                      className={`graph-legend-swatch graph-swatch-${index === 0 ? "incoming" : "outgoing"}`}
                    />
                  )}
                  {title}
                </h5>
                {connections.length ? (
                  <ul>
                    {connections.map((connection) => {
                      const target = graph.presentation.get(connection.id)!;
                      const entity = graph.entities.get(connection.id)!;
                      return (
                        <li key={connection.id}>
                          <Button
                            variant="ghost"
                            className="h-auto w-full justify-between gap-1.5 whitespace-normal px-2 py-1 text-left"
                            onClick={() => onSelect(connection)}
                            title={entity.name}
                          >
                            <span className="min-w-0 [overflow-wrap:anywhere]">
                              <span className="block text-sm leading-tight">
                                {target.title}
                              </span>
                              <span className="block text-xs font-normal text-muted-foreground">
                                {[...connection.labels].join(", ")}
                              </span>
                            </span>
                            <ChevronRight
                              aria-hidden
                              className="text-muted-foreground"
                            />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-1 pl-2 text-xs text-muted-foreground">
                    None in this trace.
                  </p>
                )}
              </div>
            ))}
          </section>
          <section
            aria-label="Implementation"
            className="space-y-1.5 px-3.5 py-3"
          >
            <h4 className="text-sm font-semibold">Implementation</h4>
            {details.schema && (
              <p className="px-2 text-xs [overflow-wrap:anywhere]">
                Schema declaration{" "}
                <code className="text-muted-foreground">
                  {sourceLabel(details.schema)}
                </code>
              </p>
            )}
            {details.sources.length ? (
              <ul>
                {details.sources.map((source) => (
                  <li key={sourceKey(source)}>
                    <SourceLink
                      source={source}
                      revision={revision}
                      owner={source.owner}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              !details.schema && (
                <p className="text-xs text-muted-foreground">
                  No source location recorded.
                </p>
              )
            )}
          </section>
          {details.edges.length > 0 && (
            <Collapsible.Root className="group px-1.5 py-1.5">
              <Collapsible.Trigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-between px-2 font-semibold"
                >
                  Detailed trace
                  <ChevronDown
                    aria-hidden
                    className="text-muted-foreground group-data-[state=open]:rotate-180"
                  />
                </Button>
              </Collapsible.Trigger>
              <Collapsible.Content className="space-y-3 px-2 pt-2 pb-1.5">
                {details.edges.map((edge) => (
                  <section key={edge.id} className="space-y-2">
                    <h5 className="text-xs font-medium [overflow-wrap:anywhere]">
                      {edge.source === selectedId
                        ? `To ${graph.entities.get(edge.target)?.name}`
                        : `From ${graph.entities.get(edge.source)?.name}`}
                    </h5>
                    {edge.data.paths.map((path) => (
                      <ol
                        key={JSON.stringify(
                          path.map(({ relationship }) => relationship.id),
                        )}
                        className="space-y-2 border-l pl-2"
                      >
                        {path.map(({ toId, relationship }) => (
                          <li
                            key={relationship.id}
                            className="text-xs [overflow-wrap:anywhere]"
                          >
                            <span className="text-muted-foreground">
                              {relationshipLabels[relationship.kind]}{" "}
                            </span>
                            <code>{graph.entities.get(toId)?.name}</code>
                            {relationship.provenance.kind === "heuristic" && (
                              <span className="text-warning"> (inferred)</span>
                            )}
                            <ul>
                              {relationship.sources.map((source) => (
                                <li key={sourceKey(source)}>
                                  <SourceLink
                                    source={source}
                                    revision={revision}
                                  />
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ol>
                    ))}
                  </section>
                ))}
              </Collapsible.Content>
            </Collapsible.Root>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

export function BehaviourEmptyState() {
  return (
    <aside
      aria-label="Selection details"
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <MousePointer2 aria-hidden className="size-4 shrink-0 text-primary" />
      <p>Select a node to see its role, connections, and source.</p>
    </aside>
  );
}
