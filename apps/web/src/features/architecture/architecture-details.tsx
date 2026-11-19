import { ArrowRight, Boxes, FileCode2, FolderOpen } from "lucide-react";
import type {
  ArchitectureConnectionWithChanges,
  ArchitectureMap,
  ArchitecturePartWithChanges,
  SemanticEntity,
} from "@mycel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { partKindLabel } from "./part-node";

interface ArchitectureDetailsProps {
  map: ArchitectureMap;
  selectedPart: ArchitecturePartWithChanges | undefined;
  selectedConnection: ArchitectureConnectionWithChanges | undefined;
  matchingFeatures: SemanticEntity[];
  onSelectPart: (partId: string) => void;
  onSelectConnection: (connectionId: string) => void;
  onClear: () => void;
  onOpenPartFiles: (part: ArchitecturePartWithChanges) => void;
  onOpenFile: (path: string) => void;
  onOpenFeature: (featureId: string) => void;
}

function ChangeBadges({
  status,
  uncommitted,
}: {
  status: "new" | "changed" | "unchanged";
  uncommitted: boolean;
}) {
  if (status === "unchanged" && !uncommitted) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status === "new" && (
        <Badge variant="outline" className="part-change-new">
          New
        </Badge>
      )}
      {status === "changed" && (
        <Badge variant="outline" className="part-change-changed">
          Changed
        </Badge>
      )}
      {uncommitted && (
        <Badge variant="secondary" className="gap-1.5">
          <span className="part-uncommitted-dot" aria-hidden />
          Uncommitted
        </Badge>
      )}
    </div>
  );
}

function formatLinkSummary(connection: ArchitectureConnectionWithChanges) {
  const pieces: string[] = [];
  if (connection.importCount > 0) {
    pieces.push(
      `${connection.importCount} ${connection.importCount === 1 ? "import" : "imports"}`,
    );
  }
  if (connection.callCount > 0) {
    pieces.push(
      `${connection.callCount} ${connection.callCount === 1 ? "call" : "calls"}`,
    );
  }
  return pieces.join(" · ") || `${connection.count} links`;
}

export function ArchitectureDetails({
  map,
  selectedPart,
  selectedConnection,
  matchingFeatures,
  onSelectPart,
  onSelectConnection,
  onClear,
  onOpenPartFiles,
  onOpenFile,
  onOpenFeature,
}: ArchitectureDetailsProps) {
  if (!selectedPart && !selectedConnection) return null;

  const addedSet = new Set(map.changes.addedFiles);
  const modifiedSet = new Set(map.changes.modifiedFiles);
  const uncommittedSet = new Set(map.changes.uncommittedFiles);
  const partById = new Map(map.parts.map((part) => [part.id, part]));

  if (selectedConnection) {
    const sourceName =
      partById.get(selectedConnection.sourcePartId)?.name ??
      selectedConnection.sourcePartId;
    const targetName =
      partById.get(selectedConnection.targetPartId)?.name ??
      selectedConnection.targetPartId;

    return (
      <aside
        aria-label="Selection details"
        className="flex min-h-0 w-[360px] max-w-1/2 shrink-0 flex-col overflow-hidden rounded-lg border bg-card"
      >
        <div className="flex shrink-0 flex-wrap items-start gap-2 border-b p-4">
          <div className="mr-auto min-w-0 space-y-1">
            <h3 className="flex flex-wrap items-center gap-1.5 text-base font-semibold">
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => onSelectPart(selectedConnection.sourcePartId)}
              >
                {sourceName}
              </button>
              <ArrowRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => onSelectPart(selectedConnection.targetPartId)}
              >
                {targetName}
              </button>
            </h3>
            <p className="font-mono text-xs text-muted-foreground">
              {formatLinkSummary(selectedConnection)}
            </p>
            <ChangeBadges
              status={selectedConnection.change.status}
              uncommitted={selectedConnection.change.uncommitted}
            />
          </div>
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear selection
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">
                Evidence{" "}
                <span className="text-muted-foreground">
                  {selectedConnection.evidence.length}
                </span>
              </h4>
              {selectedConnection.truncated && (
                <span className="text-xs text-muted-foreground">
                  Showing first {selectedConnection.evidence.length} of{" "}
                  {selectedConnection.count}
                </span>
              )}
            </div>
            <ul aria-label="Connection evidence" className="space-y-1.5">
              {selectedConnection.evidence.map((item, index) => (
                <li
                  key={`${item.kind}:${item.file}:${item.line}:${item.targetFile}:${item.symbol ?? ""}:${index}`}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full flex-col items-start gap-1 whitespace-normal break-all border border-border/60 p-2.5 text-left"
                    onClick={() => onOpenFile(item.file)}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {item.kind}
                      </Badge>
                      <span className="font-mono text-xs text-foreground">
                        {item.file}:{item.line}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {item.kind === "call" && item.symbol
                        ? `${item.sourceSymbol ? `${item.sourceSymbol} → ` : ""}${item.symbol} (${item.targetFile})`
                        : `→ ${item.targetFile}`}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </ScrollArea>
      </aside>
    );
  }

  if (!selectedPart) return null;

  const outgoing = map.connections.filter(
    (connection) => connection.sourcePartId === selectedPart.id,
  );
  const incoming = map.connections.filter(
    (connection) => connection.targetPartId === selectedPart.id,
  );

  return (
    <aside
      aria-label="Selection details"
      className="flex min-h-0 w-[360px] max-w-1/2 shrink-0 flex-col overflow-hidden rounded-lg border bg-card"
    >
      <div className="flex shrink-0 flex-col gap-2.5 border-b p-4">
        <div className="flex items-start gap-2">
          <div className="mr-auto min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">
                {partKindLabel(selectedPart.kind)}
              </Badge>
              {selectedPart.fallback && (
                <Badge variant="secondary">Fallback</Badge>
              )}
              <ChangeBadges
                status={selectedPart.change.status}
                uncommitted={selectedPart.change.uncommitted}
              />
            </div>
            <h3 className="break-words text-base font-semibold">
              {selectedPart.name}
            </h3>
            <p className="text-xs text-muted-foreground">
              {selectedPart.purpose}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear selection
          </Button>
        </div>

        {(selectedPart.change.addedFiles > 0 ||
          selectedPart.change.modifiedFiles > 0 ||
          selectedPart.change.uncommittedFiles > 0) && (
          <p className="font-mono text-xs text-muted-foreground">
            {[
              selectedPart.change.addedFiles > 0
                ? `+${selectedPart.change.addedFiles} new`
                : null,
              selectedPart.change.modifiedFiles > 0
                ? `${selectedPart.change.modifiedFiles} modified`
                : null,
              selectedPart.change.uncommittedFiles > 0
                ? `${selectedPart.change.uncommittedFiles} uncommitted`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {selectedPart.files.length > 0 && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => onOpenPartFiles(selectedPart)}
            >
              <FolderOpen className="size-3.5" aria-hidden />
              Open files
            </Button>
          )}
          {matchingFeatures.slice(0, 2).map((feature) => (
            <Button
              key={feature.id}
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => onOpenFeature(feature.id)}
            >
              <Boxes className="size-3.5" aria-hidden />
              Behaviour: {feature.name}
            </Button>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          <section aria-label="Selected connections" className="space-y-4">
            <ConnectionGroup
              title="Depends on"
              direction="outgoing"
              connections={outgoing}
              partById={partById}
              onSelectConnection={onSelectConnection}
            />
            <ConnectionGroup
              title="Used by"
              direction="incoming"
              connections={incoming}
              partById={partById}
              onSelectConnection={onSelectConnection}
            />
          </section>

          <section aria-label="Part files" className="space-y-2">
            <h4 className="text-sm font-medium">
              Files{" "}
              <span className="text-muted-foreground">
                {selectedPart.files.length}
              </span>
            </h4>
            {selectedPart.files.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No indexed source files match this part.
              </p>
            ) : (
              <ul className="space-y-1">
                {selectedPart.files.map((filePath) => {
                  const isAdded = addedSet.has(filePath);
                  const isModified = modifiedSet.has(filePath);
                  const isUncommitted = uncommittedSet.has(filePath);
                  return (
                    <li key={filePath}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto w-full justify-start gap-2 whitespace-normal break-all py-1.5 text-left font-mono text-xs"
                        onClick={() => onOpenFile(filePath)}
                      >
                        <FileCode2
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">{filePath}</span>
                        {isAdded && (
                          <span className="shrink-0 text-[10px] text-success">
                            new
                          </span>
                        )}
                        {!isAdded && isModified && (
                          <span className="shrink-0 text-[10px] text-warning">
                            edited
                          </span>
                        )}
                        {isUncommitted && (
                          <span
                            className="part-uncommitted-dot shrink-0"
                            title="Uncommitted"
                          />
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}

function ConnectionGroup({
  title,
  direction,
  connections,
  partById,
  onSelectConnection,
}: {
  title: string;
  direction: "incoming" | "outgoing";
  connections: ArchitectureConnectionWithChanges[];
  partById: Map<string, ArchitecturePartWithChanges>;
  onSelectConnection: (id: string) => void;
}) {
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <i
          className={`graph-legend-swatch graph-swatch-${direction}`}
          aria-hidden
        />
        {title}{" "}
        <span className="text-muted-foreground">{connections.length}</span>
      </h4>
      {connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">None in this view</p>
      ) : (
        <ul className="space-y-1">
          {connections.map((connection) => {
            const otherId =
              direction === "outgoing"
                ? connection.targetPartId
                : connection.sourcePartId;
            const otherName = partById.get(otherId)?.name ?? otherId;
            return (
              <li key={connection.id}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full justify-between gap-2 whitespace-normal py-2 text-left"
                  onClick={() => onSelectConnection(connection.id)}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{otherName}</span>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {formatLinkSummary(connection)}
                    </span>
                  </span>
                  <ChangeBadges
                    status={connection.change.status}
                    uncommitted={connection.change.uncommitted}
                  />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
