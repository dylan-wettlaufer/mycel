import { useState } from "react";
import type { ChangeEvent } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DiffPanel } from "@/features/source/diff-panel";
import { formatRelativeTime } from "@/lib/format";
export function RecordedChanges({
  events,
  error,
  loading,
  cursor,
  loadMore,
}: {
  events: ChangeEvent[];
  error?: string | undefined;
  loading: boolean;
  cursor: string | null;
  loadMore: () => void;
}) {
  const [changeId, setChangeId] = useState<string | null>(null);
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
      <ul className="max-h-[520px] divide-y overflow-y-auto">
        {events.map((event) => (
          <li key={event.id}>
            <Button
              variant="ghost"
              className="h-auto w-full justify-start py-3"
              onClick={() => setChangeId(event.id)}
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
      {cursor && (
        <Button variant="outline" disabled={loading} onClick={loadMore}>
          {loading ? "Loading…" : "Load older changes"}
        </Button>
      )}
      {changeId && <DiffPanel changeId={changeId} />}
    </section>
  );
}
