import { useMemo, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import type {
  ArchitectureChangeWindow,
  ArchitecturePartWithChanges,
  GraphNode,
  SemanticEntity,
} from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { GraphCanvas } from "@/features/graph/graph-canvas";
import { isFeatureList } from "@/features/semantic/feature-contracts";
import { useResource } from "@/hooks/use-resource";
import { isArchitectureMap, isRepositoryGraph } from "@/lib/contracts";
import { ArchitectureDetails } from "./architecture-details";
import {
  layoutArchitectureMap,
  minorConnectionMaxCount,
} from "./architecture-layout";

const windowOptions: { value: ArchitectureChangeWindow; label: string }[] = [
  { value: "uncommitted", label: "Uncommitted" },
  { value: "branch", label: "Branch" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

function describeWindow(map: {
  changes: {
    available: boolean;
    resolvedWindow: ArchitectureChangeWindow;
    branch: string | null;
    baseRef: string | null;
  };
}): string {
  if (!map.changes.available) return "Git history unavailable";
  if (map.changes.resolvedWindow === "uncommitted")
    return "Uncommitted changes";
  if (map.changes.resolvedWindow === "branch" && map.changes.branch) {
    return map.changes.baseRef
      ? `Branch ${map.changes.branch} vs ${map.changes.baseRef}`
      : `Branch ${map.changes.branch}`;
  }
  const period =
    map.changes.resolvedWindow === "30d" ? "last 30 days" : "last 7 days";
  return map.changes.branch ? `${map.changes.branch} · ${period}` : period;
}

function findMatchingFeatures(
  part: ArchitecturePartWithChanges | undefined,
  features: readonly SemanticEntity[] | undefined,
): SemanticEntity[] {
  if (!part || !features || features.length === 0) return [];
  const fileSet = new Set(part.files);
  const pathPrefixes = part.paths.map((pattern) =>
    pattern.replace(/\/\*\*$/, "").replace(/\/\*$/, ""),
  );
  return features.filter((feature) => {
    if (feature.sources.some((source) => fileSet.has(source.path))) return true;
    const scope =
      typeof feature.attributes.scope === "string"
        ? feature.attributes.scope
        : undefined;
    if (!scope) return false;
    return pathPrefixes.some(
      (prefix) =>
        prefix === scope ||
        prefix.startsWith(`${scope}/`) ||
        scope.startsWith(`${prefix}/`),
    );
  });
}

export function ArchitectureMapView({
  revision,
  architectureRevision,
  onSelectFile,
  onOpenPartFiles,
  onAllFiles,
  onOpenFeature,
}: {
  revision: number;
  architectureRevision: number;
  onSelectFile: (node: GraphNode) => void;
  onOpenPartFiles: (part: ArchitecturePartWithChanges) => void;
  onAllFiles: () => void;
  onOpenFeature: (featureId: string) => void;
}) {
  const [windowMode, setWindowMode] =
    useState<ArchitectureChangeWindow>("branch");
  const [selection, setSelection] = useState<
    { kind: "part"; id: string } | { kind: "connection"; id: string } | null
  >(null);
  const [showMinor, setShowMinor] = useState(false);

  const mapResource = useResource(
    `/api/architecture?window=${encodeURIComponent(windowMode)}`,
    isArchitectureMap,
    revision + architectureRevision,
  );
  const repoResource = useResource(
    "/api/graph/repository",
    isRepositoryGraph,
    revision,
  );
  const featuresResource = useResource(
    "/api/graph/semantic/features",
    isFeatureList,
    revision,
  );

  const map = mapResource.data;
  const layout = useMemo(
    () =>
      map
        ? layoutArchitectureMap(map, { showMinor })
        : { nodes: [], edges: [], hiddenMinorCount: 0 },
    [map, showMinor],
  );

  const selectedPart =
    selection?.kind === "part"
      ? map?.parts.find((part) => part.id === selection.id)
      : undefined;
  const selectedConnection =
    selection?.kind === "connection"
      ? map?.connections.find((connection) => connection.id === selection.id)
      : undefined;
  // A merged two-way line uses one connection's id for both directions.
  const selectedEdgeId = selectedConnection
    ? (layout.edges.find(
        (edge) =>
          Array.isArray(edge.data?.connectionIds) &&
          edge.data.connectionIds.includes(selectedConnection.id),
      )?.id ?? null)
    : null;

  const matchingFeatures = useMemo(
    () => findMatchingFeatures(selectedPart, featuresResource.data?.features),
    [selectedPart, featuresResource.data?.features],
  );

  const filesByPath = useMemo(
    () =>
      new Map(
        (repoResource.data?.files ?? []).map((file) => [file.path, file]),
      ),
    [repoResource.data?.files],
  );

  const openFileByPath = (path: string) => {
    const file = filesByPath.get(path);
    if (file) onSelectFile(file);
  };

  return (
    <section
      className="architecture-map flex min-h-0 min-w-0 flex-1 flex-col gap-2"
      aria-label="Architecture map"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Architecture map</h2>
          <p className="truncate text-xs text-muted-foreground">
            {map
              ? `${map.parts.length} ${map.parts.length === 1 ? "part" : "parts"} · ${map.connections.length} ${map.connections.length === 1 ? "connection" : "connections"} · ${describeWindow(map)}`
              : "Loading…"}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <div
            role="group"
            aria-label="Change window"
            className="flex flex-wrap items-center gap-1"
          >
            {windowOptions.map((option) => (
              <Button
                key={option.value}
                variant={windowMode === option.value ? "secondary" : "outline"}
                size="xs"
                aria-pressed={windowMode === option.value}
                onClick={() => setWindowMode(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {(showMinor || layout.hiddenMinorCount > 0) && (
            <Button
              variant={showMinor ? "secondary" : "outline"}
              size="xs"
              aria-pressed={showMinor}
              title={`Connections with ${minorConnectionMaxCount} or fewer imports and calls`}
              onClick={() => setShowMinor((value) => !value)}
            >
              {showMinor
                ? "Hide minor connections"
                : `Show minor connections (${layout.hiddenMinorCount})`}
            </Button>
          )}
          <Button variant="outline" size="xs" onClick={onAllFiles}>
            All file dependencies
          </Button>
        </div>
      </div>

      {map && map.fileIssues && map.fileIssues.length > 0 ? (
        <div
          role="status"
          aria-label="Architecture fallback notice"
          className="flex shrink-0 items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
        >
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0">
            Showing folder fallback because{" "}
            <code className="font-mono">.mycel/architecture.json</code> has
            validation issues: {map.fileIssues[0]?.message}
          </p>
        </div>
      ) : map && map.source === "folder-fallback" ? (
        <div
          role="status"
          aria-label="Architecture fallback notice"
          className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
        >
          <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
          <p className="min-w-0">
            Showing automatic workspace/folder parts. Add{" "}
            <code className="font-mono text-foreground">
              .mycel/architecture.json
            </code>{" "}
            (or run the Mycel agent skill) for named domain parts and
            descriptions.
          </p>
        </div>
      ) : map && map.unassignedFiles.length > 0 ? (
        <div
          role="status"
          aria-label="Unassigned files notice"
          className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground"
        >
          <p className="min-w-0">
            {map.unassignedFiles.length}{" "}
            {map.unassignedFiles.length === 1 ? "file was" : "files were"} not
            matched by{" "}
            <code className="font-mono text-foreground">
              .mycel/architecture.json
            </code>{" "}
            and fell back to folder parts.
          </p>
        </div>
      ) : null}

      {mapResource.error ? (
        <p role="alert">Architecture map unavailable. {mapResource.error}</p>
      ) : (
        map &&
        (map.parts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No architecture parts found yet.
          </p>
        ) : (
          <GraphCanvas
            key={`${map.source}:${map.parts.map((part) => part.id).join(",")}`}
            mode="architecture"
            nodes={layout.nodes}
            edges={layout.edges}
            selectedId={selectedPart?.id ?? null}
            selectedEdgeId={selectedEdgeId}
            onSelect={(id) => setSelection({ kind: "part", id })}
            onEdgeSelect={(id) => setSelection({ kind: "connection", id })}
            onClear={() => setSelection(null)}
            onOpen={(id) => {
              const part = map.parts.find((item) => item.id === id);
              if (part && part.files.length > 0) onOpenPartFiles(part);
            }}
            sidePanel={
              selectedPart || selectedConnection ? (
                <ArchitectureDetails
                  map={map}
                  selectedPart={selectedPart}
                  selectedConnection={selectedConnection}
                  matchingFeatures={matchingFeatures}
                  onSelectPart={(id) => setSelection({ kind: "part", id })}
                  onSelectConnection={(id) =>
                    setSelection({ kind: "connection", id })
                  }
                  onClear={() => setSelection(null)}
                  onOpenPartFiles={onOpenPartFiles}
                  onOpenFile={openFileByPath}
                  onOpenFeature={onOpenFeature}
                />
              ) : undefined
            }
          />
        ))
      )}
    </section>
  );
}
