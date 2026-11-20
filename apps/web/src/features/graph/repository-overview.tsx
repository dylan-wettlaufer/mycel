import { GraphCanvas } from "./graph-canvas";
import { useMemo, useState } from "react";
import type { GraphNode } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { useResource } from "@/hooks/use-resource";
import { isArchitectureMap, isRepositoryGraph } from "@/lib/contracts";
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
  component,
  architectureRevision = 0,
  onFiles,
  onOverview,
}: {
  revision: number;
  onSelect: (node: GraphNode) => void;
  files?: boolean | undefined;
  folder?: string | undefined;
  part?: string | undefined;
  component?: string | undefined;
  architectureRevision?: number;
  onFiles: (folder?: string) => void;
  onOverview: () => void;
}) {
  const { data, error } = useResource(
    "/api/graph/repository",
    isRepositoryGraph,
    revision,
  );
  const architecture = useResource(
    part
      ? component
        ? `/api/architecture?component=${encodeURIComponent(component)}`
        : "/api/architecture"
      : null,
    isArchitectureMap,
    revision + architectureRevision,
  );
  const activePart = part
    ? architecture.data?.parts.find((entry) => entry.id === part)
    : undefined;
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
            {data
              ? `${files && scoped ? scoped.files.length : data.files.length} files · ${files && scoped ? scoped.dependencies.length : data.dependencies.length} imports`
              : "Loading…"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-1">
          {files ? (
            <>
              <Button variant="outline" size="xs" onClick={onOverview}>
                {component ? "Component map" : "Architecture map"}
              </Button>
              {(folder || part) && (
                <Button variant="outline" size="xs" onClick={() => onFiles()}>
                  All file dependencies
                </Button>
              )}
            </>
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
      {part && architecture.error ? (
        <p role="alert">Component files unavailable. {architecture.error}</p>
      ) : error ? (
        <p role="alert">Repository overview unavailable. {error}</p>
      ) : (
        data &&
        (data.files.length === 0 ? (
          <p>No indexed TypeScript files yet.</p>
        ) : (
          <>
            {files && scoped?.files.length === 0 ? (
              <p>No files in this folder.</p>
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
            )}
          </>
        ))
      )}
    </section>
  );
}
