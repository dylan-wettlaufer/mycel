import { lazy, Suspense } from "react";
import type { GraphNode } from "@mycel/shared";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { Explorer } from "@/features/explorer/explorer";
import { NodeDetailsPanel } from "@/features/details/node-details";
import { RecordedChanges } from "@/features/activity/recorded-changes";
import { SourcePanel } from "@/features/source/source-panel";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { useProject } from "@/hooks/use-project";
import { useActivity } from "@/hooks/use-activity";
import { useNavigation } from "@/hooks/use-navigation";
import { useResource } from "@/hooks/use-resource";
import { isChangeEvent, isNodeDetails } from "@/lib/contracts";
const GraphPanel = lazy(() =>
  import("@/features/graph/graph-panel").then((module) => ({
    default: module.GraphPanel,
  })),
);

export function App() {
  const { navigation, navigate } = useNavigation();
  const { view, nodeId, rootId, changeId, source } = navigation;
  const activity = useActivity();
  const connection = useBackendHealth();
  const { project, error } = useProject(connection);
  const selected = useResource(
    nodeId && view === "Graph"
      ? `/api/graph/nodes/${encodeURIComponent(nodeId)}`
      : null,
    isNodeDetails,
    activity.revision,
  );
  const root = useResource(
    rootId && rootId !== nodeId && view === "Graph"
      ? `/api/graph/nodes/${encodeURIComponent(rootId)}`
      : null,
    isNodeDetails,
    activity.revision,
  );
  const localEvent = activity.events.find((event) => event.id === changeId);
  const record = useResource(
    changeId && !localEvent
      ? `/api/changes/${encodeURIComponent(changeId)}`
      : null,
    isChangeEvent,
  );
  const selectedEvent = localEvent ?? record.data;
  const node = selected.data?.node;
  const rootNode = rootId && rootId !== nodeId ? root.data?.node : node;
  const openNode = (next: GraphNode) =>
    navigate({ view: "Graph", nodeId: next.id, rootId: next.id });
  const nodeEvents = activity.events.filter(
    (event) => event.entityType === "node" && event.entityId === nodeId,
  );
  return (
    <AppShell
      view={view}
      onNavigate={(view) => navigate({ view })}
      projectName={project?.name ?? "Mycel"}
      connection={connection}
      liveConnection={activity.connection}
    >
      {view === "Dashboard" ? (
        <DashboardPage
          project={project}
          projectError={error}
          revision={activity.revision}
          events={activity.events}
          onActivity={() => navigate({ view: "Activity" })}
        />
      ) : view === "Explorer" ? (
        <Explorer revision={activity.revision} onSelect={openNode} />
      ) : view === "Activity" ? (
        <>
          {nodeId && (
            <div className="mb-4 flex items-center gap-3">
              <p className="text-sm">Activity for selected node</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ view: "Activity" })}
              >
                Show all activity
              </Button>
            </div>
          )}
          {record.error && (
            <p role="alert">Change unavailable. {record.error}</p>
          )}
          <RecordedChanges
            {...activity}
            events={nodeId ? nodeEvents : activity.events}
            selectedEvent={selectedEvent}
            onSelectEvent={(id) =>
              navigate({ ...navigation, changeId: id, source: false })
            }
            onNode={openNode}
            onSource={() => navigate({ ...navigation, source: true })}
            showSource={source ?? false}
          />
        </>
      ) : !nodeId ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Graph</h2>
          <p className="text-muted-foreground">
            Select a file or symbol to explore its connections.
          </p>
          <Button onClick={() => navigate({ view: "Explorer" })}>
            Browse files and symbols
          </Button>
        </section>
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
      ) : !node || !rootNode ? (
        <p>Loading node…</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Suspense fallback={<p>Loading graph…</p>}>
              <GraphPanel
                key={rootNode.id}
                root={rootNode}
                selected={node}
                onSelect={(next) =>
                  navigate({ ...navigation, nodeId: next.id })
                }
                revision={activity.revision}
                events={activity.events}
              />
            </Suspense>
            <div className="space-y-3">
              <NodeDetailsPanel
                node={node}
                onSelect={(next) =>
                  navigate({ ...navigation, nodeId: next.id })
                }
                onScope={(next) => navigate({ ...navigation, rootId: next.id })}
                onSource={() => navigate({ ...navigation, source: true })}
                revision={activity.revision}
              />
              <Button
                variant="outline"
                onClick={() => navigate({ view: "Activity", nodeId: node.id })}
              >
                Show node activity
              </Button>
            </div>
          </div>
          {source && (
            <>
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate({ ...navigation, source: false })}
                >
                  Close source
                </Button>
              </div>
              <SourcePanel node={node} revision={activity.revision} />
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
