import { useMemo, useState } from "react";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
                ? `${folder ? `${folder} and its direct connections. ` : ""}Arrows point from an importing file to its dependency. Select a file for symbols and source.`
                : "Every indexed file is included, even without connections. Select a folder to inspect its files. Arrows point to dependencies; counts show file imports between folders."}
            </p>
            {files && scoped?.files.length === 0 ? (
              <p>No files in this folder.</p>
            ) : (
              <div className="h-[620px] overflow-hidden rounded-lg border bg-card">
                <ReactFlow
                  key={`${files}:${folder ?? ""}:${depth}`}
                  nodes={layout.nodes}
                  edges={layout.edges}
                  fitView
                  minZoom={0.05}
                  fitViewOptions={{ padding: 0.15, minZoom: 0.05, maxZoom: 1 }}
                  colorMode="dark"
                  nodesDraggable={false}
                  nodesConnectable={false}
                  onlyRenderVisibleElements
                  onNodeClick={(_, node) => {
                    if (!files) onFiles(node.id);
                    else {
                      const file = data.files.find(
                        (file) => file.id === node.id,
                      );
                      if (file) onSelect(file);
                    }
                  }}
                >
                  <Background />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </div>
            )}
          </>
        ))
      )}
    </section>
  );
}
