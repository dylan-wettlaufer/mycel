import { GraphCanvas } from "./graph-canvas";
import { GraphNotice } from "./graph-notice";
import { useMemo, useState } from "react";
import type { ArchitecturePartWithChanges, GraphNode } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { useResource } from "@/hooks/use-resource";
import { isRepositoryGraph } from "@/lib/contracts";
import {
  fileScope,
  layoutFileDependencies,
  layoutRepositoryGroups,
} from "./repository-layout";

export function RepositoryOverview({
  revision,
  onSelect,
  files = false,
  folder,
  part,
  activePart,
  architectureError,
  architectureLoading,
  onRetryArchitecture,
  onFiles,
}: {
  revision: number;
  onSelect: (node: GraphNode) => void;
  files?: boolean | undefined;
  folder?: string | undefined;
  part?: string | undefined;
  activePart: ArchitecturePartWithChanges | undefined;
  architectureError: string | undefined;
  architectureLoading: boolean;
  onRetryArchitecture: () => void;
  onFiles: (folder?: string) => void;
}) {
  const { data, error, loading, retry } = useResource(
    "/api/graph/repository",
    isRepositoryGraph,
    revision,
    true,
  );
  const [depth, setDepth] = useState(2);
  const [selection, setSelection] = useState<{
    scope: string;
    id: string;
  } | null>(null);
  const scope = `${files}:${part ?? ""}:${folder ?? ""}:${depth}`;
  const selectedId = selection?.scope === scope ? selection.id : null;
  const scoped = useMemo(
    () =>
      data
        ? fileScope(
            data,
            part ? undefined : folder,
            activePart ? activePart.files : part ? [] : undefined,
          )
        : undefined,
    [data, folder, part, activePart],
  );
  const layout = useMemo(
    () =>
      data && scoped
        ? files
          ? layoutFileDependencies(scoped)
          : layoutRepositoryGroups(data, depth, null)
        : { nodes: [], edges: [] },
    [data, scoped, depth, files],
  );
  const scopeLabel = activePart?.name ?? part ?? folder;
  const ready = data && (!part || activePart);
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
      aria-label="Repository overview"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {files ? "File dependencies" : "Repository overview"}
          </h2>
          <p
            className="truncate text-xs text-muted-foreground"
            title={scopeLabel}
          >
            {scopeLabel ? `${scopeLabel} · ` : ""}
            {ready
              ? `${files && scoped ? scoped.files.length : data.files.length} files · ${files && scoped ? scoped.dependencies.length : data.dependencies.length} imports`
              : (part && architectureLoading) || loading
                ? "Loading…"
                : "File dependencies unavailable"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-1">
          {files ? (
            (folder || part) && (
              <Button variant="outline" size="xs" onClick={() => onFiles()}>
                All file dependencies
              </Button>
            )
          ) : (
            <>
              {[1, 2].map((value) => (
                <Button
                  key={value}
                  variant={depth === value ? "secondary" : "outline"}
                  size="xs"
                  aria-pressed={depth === value}
                  onClick={() => setDepth(value)}
                >
                  {value === 1 ? "Top-level folders" : "Nested folders"}
                </Button>
              ))}
              <Button variant="outline" size="xs" onClick={() => onFiles()}>
                All file dependencies
              </Button>
            </>
          )}
        </div>
      </div>
      {part && architectureError && (
        <GraphNotice
          error
          title={
            activePart
              ? "Could not refresh part files"
              : "Part files unavailable"
          }
          detail={architectureError}
        >
          <Button
            variant="outline"
            size="xs"
            onClick={onRetryArchitecture}
            disabled={architectureLoading}
          >
            {architectureLoading ? "Retrying…" : "Retry part"}
          </Button>
        </GraphNotice>
      )}
      {part && !activePart && !architectureError && !architectureLoading && (
        <GraphNotice
          title="Part unavailable"
          detail="This part may have been renamed or removed. Use All file dependencies to browse the current index."
        />
      )}
      {error && (
        <GraphNotice
          error
          title={
            data
              ? "Could not refresh file dependencies"
              : "File dependencies unavailable"
          }
          detail={error}
        >
          <Button
            variant="outline"
            size="xs"
            onClick={retry}
            disabled={loading}
          >
            {loading ? "Retrying…" : "Retry files"}
          </Button>
        </GraphNotice>
      )}
      {ready &&
        (data.files.length === 0 ? (
          <GraphNotice
            title="No indexed source files"
            detail="Add a TypeScript, TSX, or Python file in an indexed path. File dependencies update when Mycel indexes the save."
          />
        ) : files && scoped?.files.length === 0 ? (
          <GraphNotice
            title={
              part
                ? "No indexed files in this part"
                : "No indexed files in this folder"
            }
            detail="Use All file dependencies to browse the current index."
          />
        ) : (
          <GraphCanvas
            key={scope}
            nodes={layout.nodes}
            edges={layout.edges}
            selectedId={selectedId}
            onSelect={(id) => setSelection({ scope, id })}
            onClear={() => setSelection(null)}
            onOpen={(id) => {
              if (!files) onFiles(id);
              else {
                const file = data.files.find((file) => file.id === id);
                if (file) onSelect(file);
              }
            }}
            openLabel={files ? "Open file" : "Open files"}
          />
        ))}
    </section>
  );
}
