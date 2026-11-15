import type { GraphNode } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useResource } from "@/hooks/use-resource";
import { isSearchResult } from "@/lib/contracts";
export function FileSymbols({
  file,
  revision,
  onSelect,
}: {
  file: GraphNode;
  revision: number;
  onSelect: (node: GraphNode) => void;
}) {
  const { data, error } = useResource(
    `/api/graph/nodes/${encodeURIComponent(file.id)}/symbols`,
    isSearchResult,
    revision,
  );
  return (
    <Card aria-label="File symbols">
      <CardHeader>
        <CardTitle>Symbols in {file.name}</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert">Symbols unavailable. {error}</p>
        ) : !data ? (
          <p>Loading symbols…</p>
        ) : !data.nodes.length ? (
          <p className="text-sm text-muted-foreground">
            No declarations in this file.
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {data.nodes.map((node) => (
              <li key={node.id}>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal break-all text-left"
                  onClick={() => onSelect(node)}
                >
                  <span className="min-w-0 flex-1 text-sm">
                    {node.qualifiedName}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {node.kind} · line {node.range.startLine}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
