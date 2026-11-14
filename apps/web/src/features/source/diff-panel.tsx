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
        <h3 className="font-mono text-sm">
          Recorded change #{changeId}
          {data ? ` · ${data.path}` : ""}
        </h3>
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
      ) : (
        <Suspense fallback={<p className="p-4">Loading diff editor…</p>}>
          <MonacoDiff diff={data} />
        </Suspense>
      )}
    </section>
  );
}
