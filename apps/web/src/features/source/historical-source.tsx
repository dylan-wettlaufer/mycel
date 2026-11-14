import { lazy, Suspense } from "react";
import type { ChangeEvent } from "@mycel/shared";
import { useResource } from "@/hooks/use-resource";
import { isChangeDiff } from "@/lib/contracts";
import { eventNode } from "@/features/activity/event-node";
const MonacoView = lazy(() => import("./monaco-view"));
export function HistoricalSource({ event }: { event: ChangeEvent }) {
  const { data, error } = useResource(
    `/api/changes/${encodeURIComponent(event.id)}/diff`,
    isChangeDiff,
  );
  const content =
    event.action === "deleted" ? data?.beforeContent : data?.afterContent;
  const range = eventNode(event)?.range ?? {
    start: 0,
    end: 0,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 1,
  };
  return (
    <section
      className="overflow-hidden rounded-lg border"
      aria-label="Recorded source"
    >
      <div className="border-b px-4 py-3">
        <h3 className="font-mono text-sm">
          Recorded source · {event.path}:{range.startLine}
        </h3>
        <p className="text-xs text-muted-foreground">
          {event.action === "deleted"
            ? "Source before deletion"
            : "Source after change"}{" "}
          · change #{event.id}
        </p>
      </div>
      {error ? (
        <p role="alert" className="p-4">
          Recorded source unavailable. {error}
        </p>
      ) : !data ? (
        <p>Loading recorded source…</p>
      ) : content === null || content === undefined ? (
        <p>Source was not captured for this revision.</p>
      ) : (
        <Suspense fallback={<p>Loading editor…</p>}>
          <MonacoView
            content={content}
            path={`mycel-history://${event.id}/source/${event.path}`}
            range={range}
          />
        </Suspense>
      )}
    </section>
  );
}
