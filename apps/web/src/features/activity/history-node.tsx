import type { ChangeEvent } from "@mycel/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { eventNode } from "./event-node";
export function HistoryNode({ event }: { event: ChangeEvent }) {
  const node = eventNode(event);
  return (
    <Card
      className={
        event.action === "deleted" ? "border-destructive/60 border-dashed" : ""
      }
      aria-label="Historical node"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={event.action === "deleted" ? "text-destructive" : ""}
          >
            {event.action}
          </Badge>
          {node?.name ?? event.entityType}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          {event.action === "deleted"
            ? "Deleted from the live graph. This saved node remains available in history."
            : "Saved metadata at the time of this change."}
        </p>
        {node && (
          <>
            <p className="font-mono text-xs">
              {node.kind} · {node.qualifiedName}
            </p>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {node.path}:{node.range.startLine}:{node.range.startColumn}–
              {node.range.endLine}:{node.range.endColumn}
            </p>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Recorded {new Date(event.timestamp).toLocaleString()} · change #
          {event.id}
        </p>
      </CardContent>
    </Card>
  );
}
