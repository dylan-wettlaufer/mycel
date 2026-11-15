import { useMemo, useState } from "react";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphNode } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { useResource } from "@/hooks/use-resource";
import { isRepositoryGraph } from "@/lib/contracts";
import { groupRepository, layoutRepositoryGroups } from "./repository-layout";

export function RepositoryOverview({
  revision,
  onSelect,
}: {
  revision: number;
  onSelect: (node: GraphNode) => void;
}) {
  const { data, error } = useResource(
    "/api/graph/repository",
    isRepositoryGraph,
    revision,
  );
  const [depth, setDepth] = useState(2);
  const [folder, setFolder] = useState<string | null>(null);
  const layout = useMemo(
    () =>
      data
        ? layoutRepositoryGroups(data, depth, folder)
        : { nodes: [], edges: [] },
    [data, depth, folder],
  );
  const files =
    data && folder
      ? groupRepository(data, depth).groups.get(folder)
      : undefined;
  return (
    <section className="space-y-4" aria-label="Repository overview">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-semibold">Repository overview</h2>
        {[1, 2].map((value) => (
          <Button
            key={value}
            variant={depth === value ? "secondary" : "outline"}
            size="sm"
            aria-pressed={depth === value}
            onClick={() => {
              setDepth(value);
              setFolder(null);
            }}
          >
            {value === 1 ? "Top-level folders" : "Nested folders"}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {data
          ? `${data.files.length} indexed files · ${data.dependencies.length} file imports · revision ${data.revision}`
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
              Every indexed file is included, even without connections. Arrows
              point from an importing folder to its dependency; counts show file
              imports between folders.
            </p>
            <div className="h-[620px] overflow-hidden rounded-lg border bg-card">
              <ReactFlow
                key={depth}
                nodes={layout.nodes}
                edges={layout.edges}
                fitView
                colorMode="dark"
                nodesDraggable={false}
                nodesConnectable={false}
                onNodeClick={(_, node) => setFolder(node.id)}
              >
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
            {files && (
              <section className="space-y-2" aria-label="Folder files">
                <h3 className="font-medium">{folder}</h3>
                <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
                  {files.map((file) => (
                    <li key={file.id}>
                      <Button
                        variant="ghost"
                        className="w-full justify-start overflow-hidden"
                        onClick={() => onSelect(file)}
                      >
                        <span className="truncate font-mono text-xs">
                          {file.path}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ))
      )}
    </section>
  );
}
