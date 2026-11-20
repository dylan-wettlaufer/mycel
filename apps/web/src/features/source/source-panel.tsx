import { lazy, Suspense } from "react";
import type { GraphNode } from "@mycel/shared";
import { useResource } from "@/hooks/use-resource";
import { isFileContent } from "@/lib/contracts";
import type { SourceWorkspaceOptions } from "./monaco-view";

const MonacoView = lazy(() => import("./monaco-view"));

export function SourcePanel({
  node,
  revision = 0,
  workspace,
}: {
  node: Pick<GraphNode, "path" | "range">;
  revision?: number;
  workspace?: SourceWorkspaceOptions;
}) {
  const { data, error } = useResource(
    `/api/files/content?path=${encodeURIComponent(node.path)}`,
    isFileContent,
    revision,
  );
  return (
    <section
      className={
        workspace
          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
          : "overflow-hidden rounded-lg border"
      }
      aria-label="Source code"
    >
      {!workspace && (
        <div className="border-b px-4 py-3">
          <h3 className="font-mono text-sm [overflow-wrap:anywhere]">
            {node.path}:{node.range.startLine}
          </h3>
          <p className="text-xs text-muted-foreground">
            Read only · indexed revision {data?.revision ?? "…"}
          </p>
        </div>
      )}
      {error ? (
        <p role="alert" className="p-4">
          Source unavailable. {error}
        </p>
      ) : !data ? (
        <p className="p-4">Loading source…</p>
      ) : (
        <Suspense fallback={<p className="p-4">Loading editor…</p>}>
          <MonacoView
            content={data.content}
            path={data.path}
            range={workspace ? undefined : node.range}
            workspace={workspace}
          />
        </Suspense>
      )}
    </section>
  );
}
