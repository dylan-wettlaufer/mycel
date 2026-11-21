import { ArrowRight, FileCode2, GitCompareArrows } from "lucide-react";
import type { ArchitectureMap, ChangeEvent, GraphNode } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format";
import { ChangeDetails } from "./change-details";
import { changeTitle, fileChangePreview } from "./change-presentation";
import { useChangeFeed } from "./use-change-feed";

export function RecordedChanges({
  revision,
  nodeId,
  selectedId,
  selectedEvent,
  onSelectEvent,
  onNode,
  onSource,
  showSource,
  architecture,
  relationshipView,
  onFilter,
}: {
  revision: number;
  nodeId?: string | undefined;
  selectedId?: string | undefined;
  selectedEvent?: ChangeEvent | undefined;
  onSelectEvent: (id: string) => void;
  onNode: (node: GraphNode) => void;
  onSource: (id: string) => void;
  showSource: boolean;
  architecture?: ArchitectureMap | undefined;
  relationshipView: boolean;
  onFilter?: (enabled: boolean) => void;
}) {
  const query = new URLSearchParams(
    nodeId
      ? { node: nodeId }
      : { kind: relationshipView ? "relationships" : "files" },
  );
  const { data, error, loadingMore, loadMore } = useChangeFeed(
    query.toString(),
    revision,
  );
  const events = data?.items ?? [];
  const selected = selectedId
    ? (events.find((event) => event.id === selectedId) ?? selectedEvent)
    : nodeId
      ? undefined
      : events[0];
  const owners = new Map(
    architecture?.parts.flatMap(({ name, files }) =>
      files.map((path) => [path, name] as const),
    ),
  );
  const heading = nodeId
    ? "Symbol history"
    : relationshipView
      ? "Call & import changes"
      : "File changes";

  return (
    <section className="space-y-4" aria-labelledby="activity-title">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="activity-title" className="text-xl font-semibold">
            Activity
          </h2>
          <p className="text-sm text-muted-foreground">
            Review saved code changes, including uncommitted edits.
          </p>
        </div>
        {onFilter && (
          <div
            role="group"
            aria-label="Activity filter"
            className="inline-flex gap-1 rounded-lg border bg-muted/40 p-1"
          >
            <Button
              size="sm"
              variant={relationshipView ? "ghost" : "secondary"}
              aria-pressed={!relationshipView}
              onClick={() => onFilter(false)}
            >
              <FileCode2 aria-hidden /> Files
            </Button>
            <Button
              size="sm"
              variant={relationshipView ? "secondary" : "ghost"}
              aria-pressed={relationshipView}
              onClick={() => onFilter(true)}
            >
              <GitCompareArrows aria-hidden /> Relationships
            </Button>
          </div>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 px-3 py-2 text-sm"
        >
          History unavailable. {error}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading activity…
        </p>
      )}
      {data && events.length === 0 && !selected && (
        <Card className="items-start gap-2 px-5 py-6">
          {relationshipView ? (
            <GitCompareArrows className="size-5 text-primary" aria-hidden />
          ) : (
            <FileCode2 className="size-5 text-primary" aria-hidden />
          )}
          <h3 className="font-semibold">
            {relationshipView
              ? "No call or import changes recorded"
              : nodeId
                ? "No changes recorded for this symbol"
                : "No file edits recorded yet"}
          </h3>
          <p className="max-w-prose text-sm text-muted-foreground">
            {relationshipView
              ? "This view fills in when a save adds or removes a resolved call or import. File edits are available in Files."
              : "Mycel records edits after indexing the repository. Saved TypeScript changes will appear here."}
          </p>
          {relationshipView && onFilter && (
            <Button
              className="mt-2"
              variant="secondary"
              size="sm"
              onClick={() => onFilter(false)}
            >
              Browse file changes <ArrowRight aria-hidden />
            </Button>
          )}
        </Card>
      )}
      {(events.length > 0 || selected) && (
        <div
          className={
            events.length > 0
              ? "grid items-start gap-4 lg:grid-cols-[minmax(16rem,23rem)_minmax(0,1fr)]"
              : undefined
          }
        >
          {events.length > 0 && (
            <Card className="min-w-0 gap-0 overflow-hidden py-0">
              <h3 className="border-b px-4 py-3 text-sm font-semibold">
                {heading}
              </h3>
              <div
                role="region"
                aria-label="Recorded changes"
                tabIndex={0}
                className="max-h-[min(62svh,680px)] overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <ul className="divide-y">
                  {events.map((event) => (
                    <li key={event.id}>
                      <Button
                        variant="ghost"
                        className="block h-auto w-full rounded-none border-l-2 border-l-transparent px-4 py-3 text-left whitespace-normal aria-pressed:border-l-primary aria-pressed:bg-primary/10"
                        aria-pressed={event.id === selected?.id}
                        onClick={() => onSelectEvent(event.id)}
                      >
                        <span className="mb-1 flex items-baseline justify-between gap-3 text-xs font-normal text-muted-foreground">
                          {owners.has(event.path) && (
                            <span className="truncate">
                              {owners.get(event.path)}
                            </span>
                          )}
                          <time
                            className="ml-auto shrink-0"
                            dateTime={event.timestamp}
                          >
                            {formatRelativeTime(event.timestamp)}
                          </time>
                        </span>
                        <span className="block break-words font-medium text-foreground">
                          {changeTitle(event, architecture)}
                        </span>
                        {event.fileSummary && (
                          <span className="mt-1 block break-words text-xs font-normal text-muted-foreground">
                            {fileChangePreview(event.fileSummary)}
                          </span>
                        )}
                        <span
                          className="mt-1 block truncate font-mono text-[11px] font-normal text-muted-foreground"
                          title={event.path}
                        >
                          {event.path}
                          {event.relationship && !event.relationship.approximate
                            ? `:${event.relationship.startLine}`
                            : null}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
              {data?.cursor && (
                <div className="border-t px-3 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading…" : "Load older changes"}
                  </Button>
                </div>
              )}
            </Card>
          )}
          {selected ? (
            <ChangeDetails
              event={selected}
              title={changeTitle(selected, architecture)}
              owner={owners.get(selected.path)}
              onSource={() => onSource(selected.id)}
              onNode={onNode}
              showSource={showSource}
            />
          ) : (
            <Card className="gap-2 px-5 py-6">
              <h3 className="text-sm font-semibold">Source diff</h3>
              <p className="text-sm text-muted-foreground">
                Select a change to compare its recorded source.
              </p>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}
