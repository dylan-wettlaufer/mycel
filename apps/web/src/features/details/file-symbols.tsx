import type { GraphNode } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useResource } from "@/hooks/use-resource";
import { isSearchResult } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export function FileSymbols({
  file,
  revision,
  onSelect,
  variant = "card",
}: {
  file: GraphNode;
  revision: number;
  onSelect: (node: GraphNode) => void;
  variant?: "card" | "section";
}) {
  const { data, error } = useResource(
    `/api/graph/nodes/${encodeURIComponent(file.id)}/symbols`,
    isSearchResult,
    revision,
  );
  const flat = variant === "section";
  const title = `Symbols in ${file.name}`;
  const content = (
    <>
      {error ? (
        <p role="alert">Symbols unavailable. {error}</p>
      ) : !data ? (
        <p>Loading symbols…</p>
      ) : !data.nodes.length ? (
        <p className="text-sm text-muted-foreground">
          No declarations in this file.
        </p>
      ) : (
        <ul className={cn("space-y-1", !flat && "max-h-80 overflow-y-auto")}>
          {data.nodes.map((node) => (
            <li key={node.id}>
              <Button
                variant="ghost"
                size={flat ? "sm" : "default"}
                className="h-auto w-full justify-start whitespace-normal break-all py-2 text-left"
                onClick={() => onSelect(node)}
              >
                <span className="min-w-0 flex-1 text-sm">
                  {node.qualifiedName}
                  <span
                    className={cn(
                      "text-xs text-muted-foreground",
                      flat ? "block font-mono" : "ml-2",
                    )}
                  >
                    {node.kind} · line {node.range.startLine}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
  if (flat) {
    return (
      <section aria-label="File symbols">
        <h4 className="mb-2 text-sm font-medium">{title}</h4>
        {content}
      </section>
    );
  }
  return (
    <Card aria-label="File symbols">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
