import { eventNode } from "./event-node";
import { HistoricalSource } from "@/features/source/historical-source";
import type { GraphNode } from "@mycel/shared";
import { HistoryNode } from "./history-node";
import type { ArchitectureMap, ChangeEvent } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DiffPanel } from "@/features/source/diff-panel";
import { formatRelativeTime } from "@/lib/format";
import { ArrowDownUp } from "lucide-react";
import { Card, CardFooter } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { navigationHref } from "@/hooks/use-navigation";
import {
  relationshipPartNames,
  relationshipTitle,
} from "./relationship-change";
export function RecordedChanges({
  events,
  error,
  loading,
  cursor,
  loadMore,
  selectedEvent,
  onSelectEvent,
  onNode,
  onSource,
  showSource,
  architecture,
  relationshipView,
  onFilter,
}: {
  events: ChangeEvent[];
  error?: string | undefined;
  loading: boolean;
  cursor: string | null;
  loadMore: () => void;
  selectedEvent?: ChangeEvent | undefined;
  onSelectEvent: (id: string) => void;
  onNode: (node: GraphNode) => void;
  onSource: () => void;
  showSource: boolean;
  architecture?: ArchitectureMap | undefined;
  relationshipView: boolean;
  onFilter?: (enabled: boolean) => void;
}) {
  const selectedNode = selectedEvent ? eventNode(selectedEvent) : null;
  const visible = relationshipView
    ? events.filter((event) => event.relationship)
    : events;
  const relationship = selectedEvent?.relationship;
  const title = (event: ChangeEvent) =>
    event.relationship
      ? relationshipTitle(
          event.relationship,
          event.action === "deleted" ? "deleted" : "created",
          relationshipPartNames(architecture, event.id, event.relationship),
        )
      : undefined;
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Activity</h2>
      <p className="text-sm text-muted-foreground">
        Indexed changes · includes uncommitted saves · newest first
      </p>
      {onFilter && (
        <div
          role="group"
          aria-label="Activity filter"
          className="flex flex-wrap gap-2"
        >
          <Button
            size="sm"
            variant={relationshipView ? "outline" : "secondary"}
            aria-pressed={!relationshipView}
            onClick={() => onFilter(false)}
          >
            All changes
          </Button>
          <Button
            size="sm"
            variant={relationshipView ? "secondary" : "outline"}
            aria-pressed={relationshipView}
            onClick={() => onFilter(true)}
          >
            Relationships
          </Button>
        </div>
      )}
      {error && <p role="alert">History unavailable. {error}</p>}
      {!visible.length && (
        <p>
          {loading
            ? "Loading history…"
            : relationshipView
              ? "No recorded relationship changes in the loaded history."
              : "No recorded changes yet. Edit a TypeScript file to begin."}
        </p>
      )}
      <div
        className={
          selectedEvent
            ? "grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
            : "space-y-4"
        }
      >
        {(visible.length > 0 || cursor) && (
          <Card className="gap-0 overflow-hidden rounded-lg py-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Change history</h3>
                <Badge variant="secondary">{visible.length} changes</Badge>
              </div>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowDownUp className="size-3.5" aria-hidden />
                Scroll to browse
              </span>
            </div>
            <ScrollArea
              type="always"
              className="[&_[data-slot=scroll-area-scrollbar]]:bg-muted/40 [&_[data-slot=scroll-area-thumb]]:bg-muted-foreground/50"
              viewportProps={{
                className: "max-h-[min(520px,60svh)] [&>div]:block!",
                role: "region",
                "aria-label": "Recorded changes",
                tabIndex: 0,
              }}
            >
              <ul className="divide-y pr-3">
                {visible.map((event) => (
                  <li key={event.id}>
                    <Button
                      variant="ghost"
                      className="h-auto w-full justify-start py-3 aria-pressed:bg-muted"
                      aria-pressed={event.id === selectedEvent?.id}
                      onClick={() => onSelectEvent(event.id)}
                    >
                      <Badge
                        variant="outline"
                        className={
                          event.action === "created"
                            ? "text-success"
                            : event.action === "modified"
                              ? "text-warning"
                              : "text-destructive"
                        }
                      >
                        {event.relationship
                          ? event.action === "deleted"
                            ? "removed"
                            : "added"
                          : event.action}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-left">
                        <span
                          className={
                            event.relationship
                              ? "block whitespace-normal break-words"
                              : "block truncate"
                          }
                        >
                          {title(event) ??
                            (event.entityType === "node" &&
                            event.after &&
                            "name" in event.after
                              ? event.after.name
                              : event.path)}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {event.relationship
                            ? `${event.path}:${event.relationship.startLine} · ${event.relationship.kind === "CALLS" ? "call" : "import"}`
                            : `${event.path} · ${event.entityType}`}
                        </span>
                      </span>
                      <time
                        dateTime={event.timestamp}
                        className="text-xs text-muted-foreground"
                      >
                        {formatRelativeTime(event.timestamp)}
                      </time>
                    </Button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
            {cursor && (
              <CardFooter className="border-t px-4 py-3">
                <Button variant="outline" disabled={loading} onClick={loadMore}>
                  {loading ? "Loading…" : "Load older changes"}
                </Button>
              </CardFooter>
            )}
          </Card>
        )}
        {selectedEvent && (
          <div className="min-w-0 space-y-4">
            {relationship ? (
              <Card className="gap-2 px-4 py-3">
                <h3 className="break-words text-sm font-semibold">
                  {title(selectedEvent)}
                </h3>
                <p className="break-words font-mono text-xs text-muted-foreground">
                  {relationship.source.path}:{relationship.startLine} →{" "}
                  {relationship.target.path}
                  {relationship.approximate ? " · approximate source" : ""}
                </p>
                {relationship.features.length > 0 ? (
                  <ul
                    className="mt-1 flex flex-wrap gap-2"
                    aria-label="Affected behavior"
                  >
                    {relationship.features.map((feature) => (
                      <li key={feature.id}>
                        <Button asChild variant="outline" size="sm">
                          <a
                            href={navigationHref({
                              view: "Features",
                              featureId: feature.id,
                            })}
                          >
                            {feature.name.charAt(0).toUpperCase() +
                              feature.name.slice(1)}{" "}
                            behavior
                          </a>
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : relationship.kind === "CALLS" ? (
                  <p className="text-xs text-muted-foreground">
                    No feature behavior traced for this call.
                  </p>
                ) : null}
              </Card>
            ) : (
              <HistoryNode event={selectedEvent} />
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onSource}>
                {relationship
                  ? `Open ${selectedEvent.action === "deleted" ? "removed" : "added"} ${relationship.kind === "CALLS" ? "call" : "import"} at line ${relationship.startLine}`
                  : "Open recorded source"}
              </Button>
              {selectedNode && selectedEvent.action !== "deleted" && (
                <Button onClick={() => onNode(selectedNode)}>
                  Open live graph
                </Button>
              )}
            </div>
            {showSource && <HistoricalSource event={selectedEvent} />}
            <DiffPanel changeId={selectedEvent.id} />
          </div>
        )}
      </div>
    </section>
  );
}
