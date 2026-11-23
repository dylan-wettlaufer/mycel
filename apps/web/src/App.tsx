import { FileSymbols } from "@/features/details/file-symbols";
import { lazy, Suspense, useState } from "react";
import type { ArchitectureChangeWindow, GraphNode } from "@mycel/shared";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Explorer } from "@/features/explorer/explorer";
import { NodeDetailsPanel } from "@/features/details/node-details";
import { GraphBreadcrumbs } from "@/features/graph/graph-breadcrumbs";
import { RecordedChanges } from "@/features/activity/recorded-changes";
import { SourcePanel } from "@/features/source/source-panel";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { useProject } from "@/hooks/use-project";
import { useActivity } from "@/hooks/use-activity";
import { useNavigation } from "@/hooks/use-navigation";
import { useResource } from "@/hooks/use-resource";
import {
  isArchitectureMap,
  isChangeEvent,
  isNodeDetails,
} from "@/lib/contracts";
const GraphPanel = lazy(() =>
  import("@/features/graph/graph-panel").then((module) => ({
    default: module.GraphPanel,
  })),
);

const RepositoryOverview = lazy(() =>
  import("@/features/graph/repository-overview").then((module) => ({
    default: module.RepositoryOverview,
  })),
);

const ArchitectureMapView = lazy(() =>
  import("@/features/architecture/architecture-map").then((module) => ({
    default: module.ArchitectureMapView,
  })),
);

export function App() {
  const { navigation, navigate } = useNavigation();
  const {
    view,
    nodeId,
    rootId,
    changeId,
    relationships,
    source,
    files,
    component,
    part,
  } = navigation;
  const scopeId = rootId ?? nodeId;
  const [architectureWindow, setArchitectureWindow] =
    useState<ArchitectureChangeWindow>("branch");
  const activity = useActivity();
  const connection = useBackendHealth();
  const { project, error } = useProject(connection);
  const architecture = useResource(
    (view === "Graph" && ((!nodeId && !files) || component || part)) ||
      (view === "Activity" && !nodeId)
      ? `/api/architecture?${new URLSearchParams({
          window: architectureWindow,
          ...(component ? { component } : {}),
        })}`
      : null,
    isArchitectureMap,
    activity.revision + activity.architectureRevision,
    true,
  );
  const activePart = architecture.data?.parts.find(
    (entry) => entry.id === part,
  );
  const selected = useResource(
    nodeId && nodeId !== scopeId && view === "Graph"
      ? `/api/graph/nodes/${encodeURIComponent(nodeId)}`
      : null,
    isNodeDetails,
    activity.revision,
  );
  const root = useResource(
    scopeId && nodeId && view === "Graph"
      ? `/api/graph/nodes/${encodeURIComponent(scopeId)}`
      : null,
    isNodeDetails,
    activity.revision,
  );
  const localEvent = activity.events.find((event) => event.id === changeId);
  const record = useResource(
    view === "Activity" && changeId
      ? `/api/changes/${encodeURIComponent(changeId)}`
      : null,
    isChangeEvent,
  );
  const selectedEvent = record.data ?? localEvent;
  const relationshipView =
    !nodeId && (relationships ?? Boolean(selectedEvent?.relationship));
  const rootNode = root.data?.node;
  const nodeDetails = scopeId === nodeId ? root.data : selected.data;
  const node = nodeDetails?.node;
  const selectNode = (next: GraphNode) =>
    navigate({ ...navigation, rootId: scopeId ?? next.id, nodeId: next.id });
  const scopeNode = (next: GraphNode) =>
    navigate({ ...navigation, rootId: next.id });
  const showNodeActivity = (next: GraphNode) =>
    navigate({ view: "Activity", nodeId: next.id });
  const openNode = (next: GraphNode) =>
    navigate({ view: "Graph", nodeId: next.id, rootId: next.id });
  const openScopedNode = (next: GraphNode) =>
    navigate({ ...navigation, nodeId: next.id, rootId: next.id });
  const nodeEvents = activity.events.filter(
    (event) => event.entityType === "node" && event.entityId === nodeId,
  );
  return (
    <AppShell
      view={view}
      onNavigate={(view) => navigate({ view })}
      projectName={project?.name ?? "Mycel"}
      projectRoot={project?.root}
      connection={connection}
      liveConnection={activity.connection}
    >
      {view === "Graph" && (
        <GraphBreadcrumbs
          navigation={navigation}
          componentName={architecture.data?.component?.name}
          partName={activePart?.name}
          root={rootNode}
          selected={nodeDetails}
          unavailable={Boolean(selected.error || root.error)}
        />
      )}
      {view === "Explorer" ? (
        <Explorer revision={activity.revision} onSelect={openNode} />
      ) : view === "Activity" ? (
        <>
          {nodeId && (
            <div className="mb-4 flex items-center gap-3">
              <p className="text-sm">Activity for selected node</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate({ view: "Activity", relationships: false })
                }
              >
                Show all activity
              </Button>
            </div>
          )}
          {record.error && (
            <p role="alert">Change unavailable. {record.error}</p>
          )}
          <RecordedChanges
            key={nodeId ?? (relationshipView ? "relationships" : "files")}
            revision={activity.revision}
            nodeId={nodeId}
            selectedId={changeId}
            selectedEvent={selectedEvent}
            architecture={architecture.data}
            relationshipView={relationshipView}
            {...(!nodeId && {
              onFilter: (enabled: boolean) =>
                navigate({
                  view: "Activity",
                  relationships: enabled,
                }),
            })}
            onSelectEvent={(id) =>
              navigate({ ...navigation, changeId: id, source: false })
            }
            onNode={openNode}
            onSource={(id) =>
              navigate({ ...navigation, changeId: id, source: true })
            }
            showSource={source ?? false}
          />
        </>
      ) : !nodeId ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {error && (
            <p role="alert" className="text-sm text-muted-foreground">
              Repository details unavailable
            </p>
          )}
          {files ? (
            <Suspense fallback={<p>Loading file dependencies…</p>}>
              <RepositoryOverview
                files
                folder={navigation.folder}
                part={part}
                activePart={activePart}
                architectureError={architecture.error}
                architectureLoading={architecture.loading}
                onRetryArchitecture={architecture.retry}
                onFiles={(folder) =>
                  navigate({
                    view: "Graph",
                    files: true,
                    ...(folder ? { folder } : {}),
                  })
                }
                revision={activity.revision}
                onSelect={openScopedNode}
              />
            </Suspense>
          ) : (
            <Suspense fallback={<p>Loading architecture map…</p>}>
              <ArchitectureMapView
                revision={activity.revision}
                map={architecture.data}
                mapError={architecture.error}
                mapLoading={architecture.loading}
                onRetry={architecture.retry}
                onOverview={() => navigate({ view: "Graph" })}
                component={component}
                initialPart={part}
                windowMode={architectureWindow}
                onWindowChange={setArchitectureWindow}
                onOpenComponent={(id) =>
                  navigate({ view: "Graph", component: id })
                }
                onSelectFile={(next, focusPart) =>
                  navigate({
                    view: "Graph",
                    nodeId: next.id,
                    rootId: next.id,
                    source: true,
                    ...(component ? { component } : {}),
                    ...(focusPart ? { part: focusPart } : {}),
                  })
                }
                onOpenPartFiles={(part) =>
                  navigate({
                    view: "Graph",
                    files: true,
                    part: part.id,
                    ...(component ? { component } : {}),
                  })
                }
                onAllFiles={() => navigate({ view: "Graph", files: true })}
              />
            </Suspense>
          )}
        </div>
      ) : selected.error || root.error ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Graph</h2>
          <p role="alert">
            This node is unavailable in the live graph. It may have been
            deleted.
          </p>
          <Button
            onClick={() =>
              navigate({
                view: "Activity",
                nodeId,
                ...(nodeEvents[0] ? { changeId: nodeEvents[0].id } : {}),
              })
            }
          >
            Show node history
          </Button>
        </section>
      ) : !rootNode || (!node && rootNode.kind !== "file") ? (
        <p>Loading node…</p>
      ) : (
        <Suspense fallback={<p>Loading graph…</p>}>
          <GraphPanel
            key={rootNode.id}
            root={rootNode}
            selectedId={nodeId}
            selected={node}
            onSelect={selectNode}
            onScope={scopeNode}
            onActivity={showNodeActivity}
            revision={activity.revision}
            events={activity.events}
            details={
              rootNode.kind !== "file" &&
              node && (
                <div className="space-y-3">
                  {source && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          navigate({ ...navigation, source: false })
                        }
                      >
                        Close source
                      </Button>
                      <SourcePanel node={node} revision={activity.revision} />
                    </>
                  )}
                  <NodeDetailsPanel
                    node={node}
                    onSelect={selectNode}
                    onScope={scopeNode}
                    onSource={() => navigate({ ...navigation, source: true })}
                    revision={activity.revision}
                  />
                  {node.kind === "file" && (
                    <FileSymbols
                      file={node}
                      revision={activity.revision}
                      onSelect={openScopedNode}
                    />
                  )}
                  <Button
                    variant="outline"
                    onClick={() => showNodeActivity(node)}
                  >
                    Show node activity
                  </Button>
                </div>
              )
            }
          />
        </Suspense>
      )}
    </AppShell>
  );
}
