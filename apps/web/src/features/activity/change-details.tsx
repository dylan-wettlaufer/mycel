import { FileCode2, Network } from "lucide-react";
import type { ChangeEvent, GraphNode } from "@mycel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DiffPanel } from "@/features/source/diff-panel";
import { HistoricalSource } from "@/features/source/historical-source";
import { relationshipCountText } from "./change-presentation";
import { eventNode } from "./event-node";
import { HistoryNode } from "./history-node";
import { relationshipSymbol } from "./relationship-change";

const actionLabel = {
  created: "Added",
  modified: "Edited",
  deleted: "Removed",
};

export function ChangeDetails({
  event,
  title,
  owner,
  onSource,
  onNode,
  showSource,
}: {
  event: ChangeEvent;
  title: string;
  owner?: string | undefined;
  onSource: () => void;
  onNode: (node: GraphNode) => void;
  showSource: boolean;
}) {
  const node = eventNode(event);
  const relationship = event.relationship;
  const file = node?.kind === "file";
  const summary = event.fileSummary;
  const counts = summary ? relationshipCountText(summary) : [];
  const sourceLabel =
    relationship && !relationship.approximate
      ? `Open ${event.action === "deleted" ? "removed" : "added"} ${relationship.kind === "CALLS" ? "call" : "import"} at line ${relationship.startLine}`
      : "Open recorded source";
  return (
    <div className="min-w-0 space-y-3" aria-label="Change details">
      {node && !file ? (
        <HistoryNode event={event} />
      ) : (
        <Card className="gap-3 px-4 py-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {owner ?? (file ? "File change" : "Relationship change")}
            </p>
            <h3 className="text-base font-semibold break-words">{title}</h3>
            <p className="font-mono text-xs break-words text-muted-foreground">
              {event.path}
              {relationship && !relationship.approximate
                ? `:${relationship.startLine}`
                : ""}
              {relationship && ` → ${relationship.target.path}`}
            </p>
          </div>
          {relationship?.kind === "CALLS" && (
            <p className="font-mono text-xs break-words">
              {relationshipSymbol(relationship.source)} →{" "}
              {relationshipSymbol(relationship.target, true)}
            </p>
          )}
          {summary && (summary.symbols.length > 0 || counts.length > 0) && (
            <div className="flex flex-wrap gap-1.5" aria-label="What changed">
              {summary.symbols.map(({ name, action }) => (
                <Badge
                  key={name}
                  variant="secondary"
                  className="h-auto whitespace-normal break-all"
                >
                  {actionLabel[action]} {name}
                </Badge>
              ))}
              {summary.symbolCount > summary.symbols.length && (
                <Badge variant="secondary">
                  +{summary.symbolCount - summary.symbols.length} symbols
                </Badge>
              )}
              {counts.map((count) => (
                <Badge variant="outline" key={count}>
                  {count}
                </Badge>
              ))}
            </div>
          )}
          {relationship?.approximate && (
            <p className="text-xs text-muted-foreground">
              This earlier record identifies the connected code. Use the diff to
              find the exact edit.
            </p>
          )}
        </Card>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onSource}>
          <FileCode2 aria-hidden /> {sourceLabel}
        </Button>
        {node && event.action !== "deleted" && (
          <Button variant="outline" size="sm" onClick={() => onNode(node)}>
            <Network aria-hidden /> Open live graph
          </Button>
        )}
      </div>
      {showSource && <HistoricalSource event={event} />}
      <DiffPanel changeId={event.id} />
    </div>
  );
}
