import type { GraphNode, NodeList } from "@mycel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useResource } from "@/hooks/use-resource";
import { isNodeDetails } from "@/lib/contracts";

export function NodeDetailsPanel({
  node,
  onSelect,
  onScope,
  onSource,
  revision = 0,
  variant = "card",
}: {
  node: GraphNode;
  onSelect: (node: GraphNode) => void;
  onScope: (node: GraphNode) => void;
  onSource?: (node: GraphNode) => void;
  revision?: number;
  variant?: "card" | "section";
}) {
  const { data, error } = useResource(
    `/api/graph/nodes/${encodeURIComponent(node.id)}?limit=100`,
    isNodeDetails,
    revision,
  );
  const current = data?.node ?? node;
  const content = (
    <>
      <div className="space-y-2">
        <Badge variant="outline">{current.kind}</Badge>
        <p className="break-all font-mono text-sm font-medium">
          {current.qualifiedName}
        </p>
        <p className="break-all font-mono text-xs text-muted-foreground">
          {current.path}:{current.range.startLine}:{current.range.startColumn}–
          {current.range.endLine}:{current.range.endColumn}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onScope(current)}>
          Focus neighborhood
        </Button>
        {onSource && (
          <Button size="sm" onClick={() => onSource(current)}>
            Open source
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert">
          Node details unavailable. It may have been deleted. {error}
        </p>
      ) : !data ? (
        <p>Loading details…</p>
      ) : (
        <>
          <Relations title="Callers" list={data.callers} onSelect={onSelect} />
          <Relations
            title="Dependencies"
            list={data.dependencies}
            onSelect={onSelect}
          />
          <Relations
            title="Related files"
            list={data.relatedFiles}
            onSelect={onSelect}
          />
          {data.diagnostics.length > 0 && (
            <section>
              <h5 className="text-sm font-medium">Diagnostics</h5>
              <ul className="space-y-2 text-xs text-warning">
                {data.diagnostics.map((item, index) => (
                  <li key={index}>{item.message}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
  if (variant === "section") {
    return (
      <section aria-label="Node details" className="min-w-0">
        <h4 className="mb-2 text-sm font-medium">Node details</h4>
        <div className="space-y-4">{content}</div>
      </section>
    );
  }
  return (
    <Card className="min-w-0 gap-4" aria-label="Node details">
      <CardHeader>
        <CardTitle>
          <h4>Node details</h4>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">{content}</CardContent>
    </Card>
  );
}
function Relations({
  title,
  list,
  onSelect,
}: {
  title: string;
  list: NodeList;
  onSelect: (node: GraphNode) => void;
}) {
  return (
    <section>
      <h5 className="mb-2 text-sm font-medium">
        {title}{" "}
        <span className="text-muted-foreground">
          {list.nodes.length}
          {list.truncated ? "+" : ""}
        </span>
      </h5>
      {list.nodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-1">
          {list.nodes.map((node) => (
            <li key={node.id}>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start whitespace-normal break-all text-left"
                onClick={() => onSelect(node)}
              >
                {node.name}
                <span className="text-xs text-muted-foreground">
                  {node.path}:{node.range.startLine}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {list.truncated && (
        <p className="text-xs text-warning">
          More relationships exist. Focus this node to explore further.
        </p>
      )}
    </section>
  );
}
