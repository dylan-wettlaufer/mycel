import { useMemo, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import type { Edge } from "@xyflow/react";
import type {
  ArchitectureChangeWindow,
  ArchitectureMap,
  ArchitecturePartWithChanges,
  GraphNode,
  SemanticEntity,
} from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { GraphCanvas } from "@/features/graph/graph-canvas";
import { isFeatureList } from "@/features/semantic/feature-contracts";
import { useResource } from "@/hooks/use-resource";
import { isRepositoryGraph } from "@/lib/contracts";
import { ArchitectureDetails } from "./architecture-details";
import { RelationshipChangeLinks } from "./relationship-changes";
import { relationshipTitle } from "@/features/activity/relationship-change";
import { navigationHref } from "@/hooks/use-navigation";
import {
  componentCanvasMap,
  layoutArchitectureMap,
  minorConnectionMaxCount,
} from "./architecture-layout";

type Selection =
  | { kind: "part"; id: string }
  | { kind: "connection"; id: string; sourceName: string; targetName: string };

interface MapViewState {
  selection: Selection | null;
  focusId?: string;
}

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

/** A merged two-way line carries both connection IDs. */
function findDisplayEdgeId(
  edges: readonly Edge[],
  connectionId: string,
): string | null {
  return (
    edges.find(
      (edge) =>
        Array.isArray(edge.data?.connectionIds) &&
        edge.data.connectionIds.includes(connectionId),
    )?.id ?? null
  );
}

export function ArchitectureMapView({
  revision,
  map,
  mapError,
  component,
  initialPart,
  windowMode,
  onWindowChange,
  onOpenComponent,
  onSelectFile,
  onOpenPartFiles,
  onAllFiles,
  onOpenFeature,
}: {
  revision: number;
  map: ArchitectureMap | undefined;
  mapError: string | undefined;
  component?: string | undefined;
  initialPart?: string | undefined;
  windowMode: ArchitectureChangeWindow;
  onWindowChange: (window: ArchitectureChangeWindow) => void;
  onOpenComponent: (id: string) => void;
  onSelectFile: (node: GraphNode, part?: string) => void;
  onOpenPartFiles: (part: ArchitecturePartWithChanges) => void;
  onAllFiles: () => void;
  onOpenFeature: (featureId: string) => void;
}) {
  const scope = component ? `component:${component}` : "overview";
  const [views, setViews] = useState<Record<string, MapViewState>>({});
  const view = views[scope];
  const [showMinor, setShowMinor] = useState(false);
  const [auditComponent, setAuditComponent] = useState<string>();
  const showAll = component !== undefined && component === auditComponent;

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

  const responsibilities = map?.component
    ? map.parts.filter((part) => !part.boundary && !part.unassigned)
    : [];
  const focusId =
    responsibilities.find((part) => part.id === (view?.focusId ?? initialPart))
      ?.id ?? responsibilities[0]?.id;
  const initialSelection = initialPart ?? focusId;
  const selection: Selection | null = view
    ? view.selection
    : initialSelection
      ? { kind: "part", id: initialSelection }
      : null;
  const canvasMap = useMemo(
    () => map && componentCanvasMap(map, focusId, showAll),
    [map, focusId, showAll],
  );
  const [connectionPreview, setConnectionPreview] = useState<{
    scope: string;
    partId: string;
    ids: string[];
  } | null>(null);

  const selectedPart =
    selection?.kind === "part"
      ? map?.parts.find((part) => part.id === selection.id)
      : undefined;
  const selectedPartId = selectedPart?.id ?? null;
  const selectedNeighborIds = useMemo(() => {
    const neighbors = new Set<string>();
    if (selectedPartId === null) return neighbors;
    for (const { sourcePartId, targetPartId } of map?.connections ?? []) {
      if (sourcePartId === selectedPartId) neighbors.add(targetPartId);
      if (targetPartId === selectedPartId) neighbors.add(sourcePartId);
    }
    return neighbors;
  }, [map, selectedPartId]);
  const selectedConnection =
    selection?.kind === "connection"
      ? map?.connections.find((connection) => connection.id === selection.id)
      : undefined;
  const missingConnection =
    selection?.kind === "connection" && !selectedConnection
      ? selection
      : undefined;
  const recentChanges = map?.relationshipChanges ?? [];
  const featuredChange = recentChanges[0];
  const previewedIds =
    selectedPartId &&
    connectionPreview?.scope === scope &&
    connectionPreview.partId === selectedPartId
      ? connectionPreview.ids
      : undefined;
  const selectedConnectionId = selectedConnection?.id;
  const baseLayout = useMemo(
    () =>
      canvasMap
        ? layoutArchitectureMap(canvasMap, { showMinor })
        : { nodes: [], edges: [], hiddenMinorCount: 0 },
    [canvasMap, showMinor],
  );
  const layout = useMemo(() => {
    const ids = selectedConnectionId ? [selectedConnectionId] : previewedIds;
    if (
      !canvasMap ||
      canvasMap.component ||
      !ids?.some((id) => !findDisplayEdgeId(baseLayout.edges, id))
    ) {
      return baseLayout;
    }
    return layoutArchitectureMap(canvasMap, {
      showMinor,
      revealConnectionIds: ids,
    });
  }, [baseLayout, canvasMap, previewedIds, selectedConnectionId, showMinor]);
  const selectedEdgeId = selectedConnectionId
    ? findDisplayEdgeId(layout.edges, selectedConnectionId)
    : null;
  const previewEdgeId = previewedIds?.[0]
    ? findDisplayEdgeId(layout.edges, previewedIds[0])
    : null;

  const select = (kind: "part" | "connection", id: string) => {
    const connection =
      kind === "connection"
        ? map?.connections.find((item) => item.id === id)
        : undefined;
    if (kind === "connection" && !connection) return;
    const name = (partId: string) =>
      map?.parts.find((part) => part.id === partId)?.name ?? partId;
    setConnectionPreview(null);
    const nextFocus =
      kind === "part" && responsibilities.some((part) => part.id === id)
        ? id
        : focusId;
    setViews((previous) => ({
      ...previous,
      [scope]: {
        selection: connection
          ? {
              kind: "connection",
              id,
              sourceName: name(connection.sourcePartId),
              targetName: name(connection.targetPartId),
            }
          : { kind: "part", id },
        ...(nextFocus ? { focusId: nextFocus } : {}),
      },
    }));
  };
  const clearSelection = () => {
    setConnectionPreview(null);
    setViews((previous) => ({
      ...previous,
      [scope]: { selection: null, ...(focusId ? { focusId } : {}) },
    }));
  };
  const openComponent = (part: ArchitecturePartWithChanges) => {
    setConnectionPreview(null);
    setViews({ overview: { selection: { kind: "part", id: part.id } } });
    setAuditComponent(undefined);
    onOpenComponent(part.id);
  };

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
    if (file) onSelectFile(file, selectedPartId ?? focusId);
  };

  return (
    <section
      className="architecture-map flex min-h-0 min-w-0 flex-1 flex-col gap-2"
      aria-label="Architecture map"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {map?.component?.name ??
              (component ? "Component map" : "Architecture map")}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {map
              ? map.component
                ? `${canvasMap?.connections.length ?? 0} connections shown · ${describeWindow(map)}`
                : `${map.parts.length} ${map.parts.length === 1 ? "part" : "parts"} · ${map.connections.length} ${map.connections.length === 1 ? "connection" : "connections"} · ${describeWindow(map)}`
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
                onClick={() => onWindowChange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {!component && (showMinor || layout.hiddenMinorCount > 0) && (
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
          {!component && (
            <Button variant="outline" size="xs" onClick={onAllFiles}>
              All file dependencies
            </Button>
          )}
          {component && (
            <Button
              variant={showAll ? "secondary" : "outline"}
              size="xs"
              aria-pressed={showAll}
              onClick={() => setAuditComponent(showAll ? undefined : component)}
            >
              Show all connections
            </Button>
          )}
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
      ) : map && !component && map.unassignedFiles.length > 0 ? (
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

      {map?.relationshipChanges !== undefined && (
        <details className="shrink-0 rounded-md border bg-card px-3 py-2">
          <summary className="cursor-pointer rounded-sm text-xs focus-visible:outline-2 focus-visible:outline-ring">
            <span className="font-medium">Recent relationship changes</span>{" "}
            <span className="ml-2 text-muted-foreground" aria-live="polite">
              {featuredChange
                ? relationshipTitle(
                    featuredChange.relationship,
                    featuredChange.action,
                    featuredChange,
                  )
                : "No relationship changes in the last 7 days"}
            </span>
          </summary>
          <div className="mt-2 max-h-44 overflow-y-auto">
            {recentChanges.length > 0 ? (
              <RelationshipChangeLinks changes={recentChanges.slice(0, 12)} />
            ) : (
              <p className="text-xs text-muted-foreground">
                Changes appear here when a save adds or removes a resolved call
                or import between architecture parts.
              </p>
            )}
            <Button asChild variant="link" size="sm" className="px-0">
              <a
                href={navigationHref({ view: "Activity", relationships: true })}
              >
                View relationship activity
              </a>
            </Button>
          </div>
        </details>
      )}

      {mapError ? (
        <p role="alert">Architecture map unavailable. {mapError}</p>
      ) : (
        map &&
        (map.parts.length === 0 && !missingConnection ? (
          <p className="text-sm text-muted-foreground">
            No architecture parts found yet.
          </p>
        ) : (
          <GraphCanvas
            key={`${scope}:${map.source}:${canvasMap?.parts.map((part) => part.id).join(",")}`}
            mode="architecture"
            nodes={layout.nodes}
            edges={layout.edges}
            selectedId={selectedPartId}
            selectedNeighborIds={selectedNeighborIds}
            selectedEdgeId={selectedEdgeId}
            previewEdgeId={previewEdgeId}
            hideConnectionFilter={Boolean(component)}
            onSelect={(id) => select("part", id)}
            onEdgeSelect={(id) => select("connection", id)}
            onClear={clearSelection}
            onOpen={(id) => {
              const part = map.parts.find((item) => item.id === id);
              if (!part) return;
              if (!component && part.subcomponents?.length) openComponent(part);
              else if (part.files.length > 0) onOpenPartFiles(part);
            }}
            sidePanel={
              map.component ||
              selectedPart ||
              selectedConnection ||
              missingConnection ? (
                <ArchitectureDetails
                  map={map}
                  selectedPart={selectedPart}
                  selectedConnection={selectedConnection}
                  missingConnection={missingConnection}
                  matchingFeatures={matchingFeatures}
                  onSelectPart={(id) => select("part", id)}
                  onSelectConnection={(id) => select("connection", id)}
                  onPreviewConnections={(ids) =>
                    setConnectionPreview(
                      selectedPartId && ids.length
                        ? { scope, partId: selectedPartId, ids }
                        : null,
                    )
                  }
                  onClear={clearSelection}
                  onOpenPartFiles={onOpenPartFiles}
                  onOpenComponent={openComponent}
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
