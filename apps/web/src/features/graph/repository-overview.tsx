import { GraphCanvas } from "./graph-canvas";
import { useMemo, useState } from "react";
import type { GraphNode } from "@mycel/shared";
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
  onFiles,
  onOverview,
}: {
  revision: number;
  onSelect: (node: GraphNode) => void;
  files?: boolean | undefined;
  folder?: string | undefined;
  onFiles: (folder?: string) => void;
  onOverview: () => void;
}) {
  const { data, error } = useResource(
    "/api/graph/repository",
    isRepositoryGraph,
    revision,
  );
  const [depth, setDepth] = useState(2);
  const [selection, setSelection] = useState<{
    scope: string;
    id: string;
  } | null>(null);
  const scope = `${files}:${folder ?? ""}:${depth}`;
  const selectedId = selection?.scope === scope ? selection.id : null;
  const scoped = useMemo(
    () => (data ? fileScope(data, folder) : undefined),
    [data, folder],
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
  return (
    <section className="space-y-4" aria-label="Repository overview">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-semibold">
          {files ? "File dependencies" : "Repository overview"}
        </h2>
        {files ? (
          <>
            <Button variant="outline" size="sm" onClick={onOverview}>
              Repository overview
            </Button>
            {folder && (
              <Button variant="outline" size="sm" onClick={() => onFiles()}>
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
                size="sm"
                aria-pressed={depth === value}
                onClick={() => setDepth(value)}
              >
                {value === 1 ? "Top-level folders" : "Nested folders"}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={() => onFiles()}>
              All file dependencies
            </Button>
          </>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {data
          ? files && scoped
            ? `${scoped.files.length} files in view · ${scoped.dependencies.length} imports · ${data.files.length} indexed files in repository · revision ${data.revision}`
            : `${data.files.length} indexed files · ${data.dependencies.length} file imports · revision ${data.revision}`
          : "Loading repository…"}
      </p>
      {error ? (
        <p role="alert">Repository overview unavailable. {error}</p>
      ) : (
        data &&
        (data.files.length === 0 ? (
          <p>No indexed TypeScript files yet.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {files
                ? `${folder ? `${folder} and its direct connections. ` : ""}Arrows point from an importing file to its dependency. Select a file to trace its connections, then Open file for symbols and source.`
                : "Every indexed file is included, even without connections. Select a folder to trace its connections, then Open files to inspect it. Arrows point to dependencies; counts show file imports between folders."}
            </p>
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
