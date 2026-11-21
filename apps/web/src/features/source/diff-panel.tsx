import { lazy, Suspense } from "react";
import { useResource } from "@/hooks/use-resource";
import { isChangeDiff } from "@/lib/contracts";
const MonacoDiff = lazy(() => import("./monaco-diff"));
export function DiffPanel({ changeId }: { changeId: string }) {
  const { data, error } = useResource(
    `/api/changes/${encodeURIComponent(changeId)}/diff`,
    isChangeDiff,
  );
  return (
    <section
      className="overflow-hidden rounded-lg border"
      aria-label="Recorded source diff"
    >
      <div className="border-b px-4 py-3">
        <h3 className="font-mono text-sm">Source diff</h3>
        {data && (
          <p className="text-xs text-muted-foreground">
            Before:{" "}
            {data.beforeRevision === null
              ? "file absent"
              : `revision ${data.beforeRevision}`}{" "}
            → After:{" "}
            {data.afterRevision === null
              ? "file deleted"
              : `revision ${data.afterRevision}`}
          </p>
        )}
      </div>
      {error ? (
        <p role="alert" className="p-4">
          Recorded source unavailable. {error}
        </p>
      ) : !data ? (
        <p className="p-4">Loading diff…</p>
      ) : data.beforeContent === data.afterContent ? (
        <p className="p-4 text-sm text-muted-foreground">
          {data.beforeContent === null
            ? "Source was unavailable for these revisions."
            : "The file has identical text in both revisions."}
        </p>
      ) : (
        <Suspense fallback={<p className="p-4">Loading diff editor…</p>}>
          <MonacoDiff diff={data} />
        </Suspense>
      )}
    </section>
  );
}
