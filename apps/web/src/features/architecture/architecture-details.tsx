import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  ChevronRight,
  FileCode2,
  FolderOpen,
  X,
} from "lucide-react";
import type {
  ArchitectureConnectionEvidence,
  ArchitectureConnectionWithChanges,
  ArchitectureMap,
  ArchitecturePartWithChanges,
  SemanticEntity,
} from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SourcePanel } from "@/features/source/source-panel";
import { formatLinkSummary } from "./architecture-layout";
import {
  describeChangePeriod,
  groupConnectionEvidence,
  groupPartConnections,
  groupPartFiles,
  entryPointsForPart,
  splitFilePath,
  type PartConnectionRow,
} from "./architecture-inspector-data";
import { partKindLabel } from "./part-node";

interface ArchitectureDetailsProps {
  map: ArchitectureMap;
  selectedPart: ArchitecturePartWithChanges | undefined;
  selectedConnection: ArchitectureConnectionWithChanges | undefined;
  matchingFeatures: SemanticEntity[];
  onSelectPart: (partId: string) => void;
  onSelectConnection: (connectionId: string) => void;
  onPreviewConnections: (connectionIds: string[]) => void;
  onClear: () => void;
  onOpenPartFiles: (part: ArchitecturePartWithChanges) => void;
  onOpenComponent: (part: ArchitecturePartWithChanges) => void;
  onOpenFile: (path: string) => void;
  onOpenFeature: (featureId: string) => void;
  revision: number;
}

function Inspector({
  header,
  children,
  onClear,
}: {
  header: ReactNode;
  children: ReactNode;
  onClear: () => void;
}) {
  return (
    <aside
      aria-label="Selection details"
      className="flex h-[46%] min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-lg border bg-card md:h-auto md:w-[360px] md:max-w-1/2"
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="relative border-b p-4">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Clear selection"
            title="Close details"
            className="absolute right-2.5 top-2.5 text-muted-foreground"
            onClick={onClear}
          >
            <X aria-hidden />
          </Button>
          {header}
        </div>
        {children}
      </ScrollArea>
    </aside>
  );
}

function linkChangeText(connections: ArchitectureConnectionWithChanges[]) {
  if (connections.some(({ change }) => change.status === "new")) {
    return "New link in this period";
  }
  if (connections.some(({ change }) => change.status === "changed")) {
    return "Files changed at one end";
  }
}

export function ArchitectureDetails(props: ArchitectureDetailsProps) {
  const { map, selectedPart, selectedConnection, onClear } = props;
  const partNames = new Map(map.parts.map(({ id, name }) => [id, name]));
  if (selectedConnection) {
    return (
      <ConnectionDetails
        key={selectedConnection.id}
        connection={selectedConnection}
        reverse={map.connections.find(
          ({ sourcePartId, targetPartId }) =>
            sourcePartId === selectedConnection.targetPartId &&
            targetPartId === selectedConnection.sourcePartId,
        )}
        partNames={partNames}
        onSelectPart={props.onSelectPart}
        onSelectConnection={props.onSelectConnection}
        onOpenFile={props.onOpenFile}
        revision={props.revision}
        onClear={onClear}
      />
    );
  }
  if (!selectedPart) return null;

  const { twoWay, uses, usedBy, strongest } = groupPartConnections(
    selectedPart.id,
    map.connections,
  );
  const hasConnections = twoWay.length + uses.length + usedBy.length > 0;
  const isResponsibility = Boolean(map.component && !selectedPart.boundary);
  const entries = entryPointsForPart(
    selectedPart,
    map.connections,
    isResponsibility,
  ).slice(0, 5);
  const { files, change } = selectedPart;
  const changed = change.addedFiles + change.modifiedFiles;
  const changeLine = map.changes.available
    ? [
        `${changed} of ${files.length} files changed`,
        describeChangePeriod(map.changes),
        change.uncommittedFiles > 0 &&
        map.changes.resolvedWindow !== "uncommitted"
          ? `${change.uncommittedFiles} uncommitted`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Git history unavailable";

  return (
    <Inspector
      key={selectedPart.id}
      onClear={onClear}
      header={
        <>
          <h3 className="pr-8 text-lg font-semibold leading-tight break-words">
            {selectedPart.name}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedPart.boundary
              ? "External component"
              : isResponsibility
                ? "Responsibility"
                : partKindLabel(selectedPart.kind)}{" "}
            · {files.length} {files.length === 1 ? "file" : "files"}
          </p>
          <p className="mt-3 text-sm leading-snug">{selectedPart.purpose}</p>
          <p className="mt-2 text-xs text-muted-foreground">{changeLine}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {!map.component && Boolean(selectedPart.subcomponents?.length) && (
              <Button
                size="sm"
                onClick={() => props.onOpenComponent(selectedPart)}
              >
                <Boxes aria-hidden />
                Open component
              </Button>
            )}
            {files.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => props.onOpenPartFiles(selectedPart)}
              >
                <FolderOpen aria-hidden />
                Open files
              </Button>
            )}
            {props.matchingFeatures.slice(0, 2).map((feature) => (
              <Button
                key={feature.id}
                size="sm"
                variant="outline"
                className="h-auto max-w-full whitespace-normal py-1.5 text-left"
                onClick={() => props.onOpenFeature(feature.id)}
              >
                <Boxes aria-hidden />
                Behaviour: {feature.name}
              </Button>
            ))}
          </div>
        </>
      }
    >
      <section
        aria-label="Selected connections"
        className="space-y-3 border-b p-4"
      >
        <h4 className="text-sm font-semibold">Connections</h4>
        {!hasConnections && (
          <p className="text-xs text-muted-foreground">
            No connections to other parts.
          </p>
        )}
        <ConnectionGroup
          title="Two-way"
          icon={ArrowLeftRight}
          rows={twoWay}
          strongest={strongest}
          partNames={partNames}
          onSelect={props.onSelectConnection}
          onPreview={props.onPreviewConnections}
        />
        <ConnectionGroup
          title="Uses"
          icon={ArrowRight}
          rows={uses}
          strongest={strongest}
          partNames={partNames}
          onSelect={props.onSelectConnection}
          onPreview={props.onPreviewConnections}
        />
        <ConnectionGroup
          title="Used by"
          icon={ArrowLeft}
          rows={usedBy}
          strongest={strongest}
          partNames={partNames}
          onSelect={props.onSelectConnection}
          onPreview={props.onPreviewConnections}
        />
      </section>

      {(isResponsibility || entries.length > 0) && (
        <section aria-label="Entry points" className="space-y-1 border-b p-4">
          <h4 className="mb-1 text-sm font-semibold">Entry points</h4>
          {entries.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No indexed incoming links.
            </p>
          )}
          <ul>
            {entries.map(({ path, callers }) => (
              <li key={path}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full items-start justify-start whitespace-normal px-2 py-1.5 text-left"
                  title={path}
                  onClick={() => props.onOpenFile(path)}
                >
                  <FileCode2
                    className="mt-0.5 size-3.5 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs">
                      {splitFilePath(path).name}
                    </span>
                    {callers.map(({ partId, symbols }) => (
                      <span
                        key={partId}
                        className="block break-words text-xs font-normal text-muted-foreground"
                      >
                        Used by {partNames.get(partId) ?? partId}
                        {symbols.length > 0 && (
                          <>
                            {" · "}
                            <code className="font-mono">
                              {symbols
                                .map((symbol) => `${symbol}()`)
                                .join(", ")}
                            </code>
                          </>
                        )}
                      </span>
                    ))}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PartFiles
        part={selectedPart}
        changes={map.changes}
        onOpenFile={props.onOpenFile}
      />
    </Inspector>
  );
}

function ConnectionGroup({
  title,
  icon: Icon,
  rows,
  strongest,
  partNames,
  onSelect,
  onPreview,
}: {
  title: string;
  icon: typeof ArrowRight;
  rows: PartConnectionRow[];
  strongest: number;
  partNames: ReadonlyMap<string, string>;
  onSelect: (id: string) => void;
  onPreview: (ids: string[]) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h5 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {title}
        <Icon
          className="size-3.5 text-[var(--architecture-relationship)]"
          aria-hidden
        />
      </h5>
      <ul>
        {rows.map((row) => {
          const primary = (row.uses ?? row.usedBy)!;
          const links =
            row.uses && row.usedBy ? [row.uses, row.usedBy] : [primary];
          const status = linkChangeText(links);
          const preview = () => onPreview(links.map(({ id }) => id));
          return (
            <li key={row.partId}>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-between gap-3 whitespace-normal px-2 py-1.5 text-left"
                onClick={() => onSelect(primary.id)}
                onMouseEnter={preview}
                onMouseLeave={() => onPreview([])}
                onFocus={preview}
                onBlur={() => onPreview([])}
                title={status}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex w-full items-center gap-1.5">
                    <span className="min-w-0 break-words">
                      {partNames.get(row.partId) ?? row.partId}
                    </span>
                    {links.some(({ change }) => change.status === "new") && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-success"
                        role="img"
                        aria-label="New link in this period"
                      />
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                    {row.uses && row.usedBy ? (
                      <>
                        <ArrowLeftRight
                          className="size-3 text-[var(--architecture-relationship)]"
                          aria-hidden
                        />
                        {`uses ${row.uses.count} · used by ${row.usedBy.count}`}
                      </>
                    ) : (
                      formatLinkSummary(primary)
                    )}
                  </span>
                </span>
                <span
                  className="h-[3px] w-12 shrink-0 overflow-hidden rounded-full bg-border"
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-full bg-[var(--architecture-relationship)]/65"
                    style={{ width: `${(row.count / strongest) * 100}%` }}
                  />
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PartFiles({
  part,
  changes,
  onOpenFile,
}: {
  part: ArchitecturePartWithChanges;
  changes: ArchitectureMap["changes"];
  onOpenFile: (path: string) => void;
}) {
  const folders = groupPartFiles(part.files, changes);
  return (
    <details
      key={part.id}
      open={part.files.length <= 12}
      className="group/files p-4"
      aria-label="Part files"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronRight
          className="size-3.5 text-muted-foreground group-open/files:rotate-90"
          aria-hidden
        />
        Files{" "}
        <span className="font-normal text-muted-foreground">
          {part.files.length}
        </span>
      </summary>
      {folders.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No indexed source files match this part.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {folders.map(({ folder, files }) => (
            <div key={folder}>
              <h5 className="mb-1 break-all font-mono text-xs text-muted-foreground">
                {folder || "Repository root"}
              </h5>
              <ul>
                {files.map(({ path, name, status, uncommitted }) => (
                  <li key={path}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto w-full justify-start gap-2 whitespace-normal px-2 py-1.5 text-left"
                      title={path}
                      onClick={() => onOpenFile(path)}
                    >
                      <FileCode2
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 break-all font-mono text-xs">
                        {name}
                      </span>
                      {status && (
                        <span
                          className={
                            status === "new"
                              ? "text-[10px] text-success"
                              : "text-[10px] text-warning"
                          }
                        >
                          {status}
                        </span>
                      )}
                      {uncommitted && (
                        <span className="text-[10px] text-muted-foreground">
                          uncommitted
                        </span>
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

function ConnectionDetails({
  connection,
  reverse,
  partNames,
  onSelectPart,
  onSelectConnection,
  onOpenFile,
  revision,
  onClear,
}: {
  connection: ArchitectureConnectionWithChanges;
  reverse: ArchitectureConnectionWithChanges | undefined;
  partNames: ReadonlyMap<string, string>;
  onSelectPart: (id: string) => void;
  onSelectConnection: (id: string) => void;
  onOpenFile: (path: string) => void;
  revision: number;
  onClear: () => void;
}) {
  const [source, setSource] = useState<Pick<
    ArchitectureConnectionEvidence,
    "file" | "line"
  > | null>(null);
  const groups = groupConnectionEvidence(connection.evidence);
  const partLink = (id: string) => (
    <button
      type="button"
      className="break-words text-left underline-offset-2 hover:underline"
      onClick={() => onSelectPart(id)}
    >
      {partNames.get(id) ?? id}
    </button>
  );
  return (
    <Inspector
      onClear={onClear}
      header={
        <>
          <h3 className="flex flex-wrap items-center gap-1.5 pr-8 text-base font-semibold">
            {partLink(connection.sourcePartId)}
            <ArrowRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            {partLink(connection.targetPartId)}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {[
              formatLinkSummary(connection),
              linkChangeText([connection]),
              connection.change.uncommitted ? "Uncommitted" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {reverse && (
            <Button
              size="xs"
              variant="secondary"
              className="mt-2"
              onClick={() => onSelectConnection(reverse.id)}
            >
              <ArrowLeftRight aria-hidden />
              Show reverse connection
            </Button>
          )}
        </>
      }
    >
      {source ? (
        <div className="space-y-2 p-4">
          <Button variant="ghost" size="xs" onClick={() => setSource(null)}>
            <ArrowLeft aria-hidden />
            Back to evidence
          </Button>
          <SourcePanel
            revision={revision}
            node={{
              path: source.file,
              range: {
                start: 0,
                end: 0,
                startLine: source.line,
                startColumn: 1,
                endLine: source.line + 1,
                endColumn: 1,
              },
            }}
          />
        </div>
      ) : (
        <section aria-label="Connection evidence" className="space-y-2 p-4">
          <h4 className="text-sm font-semibold">
            Evidence{" "}
            <span className="font-normal text-muted-foreground">
              {connection.evidence.length}
            </span>
          </h4>
          {connection.truncated && (
            <p className="text-xs text-muted-foreground">
              Showing {connection.evidence.length} of {connection.count} links.
            </p>
          )}
          {groups.map(([file, items]) => (
            <details
              key={file}
              open={groups.length === 1}
              className="group/evidence rounded-md border"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm p-2.5 focus-visible:outline-2 focus-visible:outline-ring">
                <ChevronRight
                  className="size-3.5 shrink-0 text-muted-foreground group-open/evidence:rotate-90"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 break-all font-mono text-xs">
                  {file}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {items.length} {items.length === 1 ? "link" : "links"}
                </span>
              </summary>
              <div className="border-t px-2.5 py-2">
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Open source ${file}`}
                  onClick={() => onOpenFile(file)}
                >
                  <FileCode2 aria-hidden />
                  Open source
                </Button>
                <ul className="mt-1 space-y-2">
                  {items.map((item, index) => (
                    <li key={index} className="font-mono text-[11px] break-all">
                      <div className="flex flex-wrap gap-x-2">
                        {[item.line, ...(item.additionalLines ?? [])].map(
                          (line) => {
                            const label = `${item.approximate ? "Source starts at line" : "Line"} ${line} · ${item.kind}`;
                            return (
                              <Button
                                key={line}
                                variant="link"
                                size="xs"
                                className="h-auto p-0 font-mono"
                                aria-label={
                                  item.symbol
                                    ? `${label} · ${item.symbol}`
                                    : label
                                }
                                onClick={() =>
                                  setSource({ file: item.file, line })
                                }
                              >
                                {label}
                              </Button>
                            );
                          },
                        )}
                      </div>
                      <p>
                        {item.kind === "call" && item.symbol
                          ? `${item.sourceSymbol ? `${item.sourceSymbol} → ` : ""}${item.symbol} (${item.targetFile})`
                          : `→ ${item.targetFile}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ))}
        </section>
      )}
    </Inspector>
  );
}
