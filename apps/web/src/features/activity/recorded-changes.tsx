import { eventNode } from "./event-node";
import { HistoricalSource } from "@/features/source/historical-source";
import type { GraphNode } from "@mycel/shared";
import { HistoryNode } from "./history-node";
import type { ChangeEvent } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DiffPanel } from "@/features/source/diff-panel";
import { formatRelativeTime } from "@/lib/format";
import { ArrowDownUp } from "lucide-react";
import { Card, CardFooter } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
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
}) {
  const selectedNode = selectedEvent ? eventNode(selectedEvent) : null;
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Activity</h2>
      <p className="text-sm text-muted-foreground">
        Committed structural changes · newest first
      </p>
      {error && <p role="alert">History unavailable. {error}</p>}
      {!events.length && (
        <p>
          {loading
            ? "Loading history…"
            : "No recorded changes yet. Edit a TypeScript file to begin."}
        </p>
      )}
      {(events.length > 0 || cursor) && (
        <Card className="gap-0 overflow-hidden rounded-lg py-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Change history</h3>
              <Badge variant="secondary">{events.length} changes</Badge>
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
              {events.map((event) => (
                <li key={event.id}>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start py-3"
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
                      {event.action}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-left">
                      <span className="block truncate">
                        {event.entityType === "node" &&
                        event.after &&
                        "name" in event.after
                          ? event.after.name
                          : event.path}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {event.path} · {event.entityType}
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
        <div className="space-y-4">
          <HistoryNode event={selectedEvent} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSource}>
              Open recorded source
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
    </section>
  );
}
