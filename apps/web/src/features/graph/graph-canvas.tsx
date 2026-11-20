import { ChevronDown, Focus, Filter, Scan, ZoomIn } from "lucide-react";
import { Collapsible } from "radix-ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { graphNodeTypes } from "./graph-node";
import { focusGraph, graphConnections } from "./graph-focus";
import { BehaviourEdgeView } from "./behaviour-edge";
import {
  BehaviourViewport,
  behaviourFitOptions,
  type BehaviourView,
} from "./behaviour-viewport";

const fitViewOptions = { padding: 0.15, minZoom: 0.03, maxZoom: 0.8 };
const architectureFitOptions = { padding: 0.08, minZoom: 0.05, maxZoom: 1 };
const edgeTypes = { behaviour: BehaviourEdgeView };

function name(node: Node): string {
  return String(node.data.name ?? node.data.label);
}

// Keep React Flow's measured dimensions alongside positions so a controlled
// update doesn't hide nodes and reset their handles while they are remeasured.
function withNodeState(nodes: Node[], state: Map<string, Node>): Node[] {
  return nodes.map((node) => {
    const current = state.get(node.id);
    return current
      ? {
          ...node,
          position: current.position,
          ...(current.measured ? { measured: current.measured } : {}),
          dragging: current.dragging ?? false,
        }
      : node;
  });
}

type NodeState = { layout: Node[]; byId: Map<string, Node> };

function applyLayout(
  layout: Node[],
  previous: NodeState,
  anchorId: string | undefined,
): NodeState {
  const before =
    previous.byId.get(anchorId ?? "") ??
    previous.layout.find((node) => node.id === anchorId);
  const after = layout.find((node) => node.id === anchorId);
  const offset =
    before && after
      ? {
          x: before.position.x - after.position.x,
          y: before.position.y - after.position.y,
        }
      : { x: 0, y: 0 };
  return {
    layout,
    byId: new Map(
      layout.map((node) => {
        const measured = previous.byId.get(node.id)?.measured;
        return [
          node.id,
          {
            ...node,
            ...(measured ? { measured } : {}),
            position: {
              x: node.position.x + offset.x,
              y: node.position.y + offset.y,
            },
          },
        ];
      }),
    ),
  };
}

export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  selectedEdgeId = null,
  previewEdgeId = null,
  selectedNeighborIds,
  onSelect,
  onEdgeSelect,
  onClear,
  onOpen,
  openLabel,
  mode = "imports",
  layoutAnchorId,
  behaviourView,
  details,
  sidePanel,
  hideConnectionFilter = false,
  hideSelectionDetails = false,
}: {
  nodes: Node[];
  edges: Edge[];
  selectedId: string | null;
  selectedEdgeId?: string | null;
  previewEdgeId?: string | null;
  selectedNeighborIds?: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onEdgeSelect?: ((id: string) => void) | undefined;
  onClear: () => void;
  onOpen?: ((id: string) => void) | undefined;
  openLabel?: string;
  mode?: "imports" | "symbols" | "behaviour" | "architecture";
  layoutAnchorId?: string | undefined;
  behaviourView?: BehaviourView;
  details?: ReactNode;
  sidePanel?: ReactNode;
  hideConnectionFilter?: boolean;
  hideSelectionDetails?: boolean;
}) {
  const [onlyConnections, setOnlyConnections] = useState(false);
  const [nodeState, setNodeState] = useState<NodeState>(() => ({
    layout: nodes,
    byId: new Map(),
  }));
  const flow = useRef<ReactFlowInstance | null>(null);
  const userMoved = useRef(false);
  const canvas = useRef<HTMLDivElement>(null);
  const behaviour = mode === "behaviour";
  const fitOptions = behaviour
    ? behaviourFitOptions
    : mode === "architecture"
      ? architectureFitOptions
      : fitViewOptions;
  const viewportDuration = behaviour ? 0 : 200;
  if (behaviour && nodeState.layout !== nodes) {
    // Apply the new positions before React Flow sees them, keeping the card
    // that triggered the layout at the same position in the current viewport.
    setNodeState(applyLayout(nodes, nodeState, layoutAnchorId));
  }
  useEffect(() => {
    const element = canvas.current;
    if (behaviour || !element || layoutAnchorId) return;
    let size: string | undefined;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const nextSize = `${width}:${height}`;
      if (size !== undefined && size !== nextSize && width > 0 && height > 0) {
        cancelAnimationFrame(frame);
        // Wait for React Flow to observe the new canvas dimensions first.
        frame = requestAnimationFrame(() => {
          void flow.current?.fitView({ ...fitOptions, duration: 200 });
        });
      }
      size = nextSize;
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [behaviour, fitOptions, layoutAnchorId]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  // Architecture maps preview a part's connections on hover.
  const previewId = mode === "architecture" ? hoveredNodeId : null;
  const focused = useMemo(
    () =>
      focusGraph(
        nodes,
        edges,
        selectedId,
        onlyConnections,
        selectedEdgeId,
        previewEdgeId ?? hoveredEdgeId,
        previewId,
        selectedNeighborIds,
      ),
    [
      nodes,
      edges,
      previewId,
      selectedId,
      onlyConnections,
      selectedEdgeId,
      hoveredEdgeId,
      previewEdgeId,
      selectedNeighborIds,
    ],
  );
  const visibleNodes = useMemo(
    () => withNodeState(focused.nodes, nodeState.byId),
    [focused.nodes, nodeState.byId],
  );
  const onNodesChange = useCallback<OnNodesChange>(
    (changes) => {
      setNodeState((previous) => {
        const layout = behaviour ? previous.layout : nodes;
        return {
          layout,
          byId: new Map(
            applyNodeChanges(changes, withNodeState(layout, previous.byId)).map(
              (node) => [node.id, node],
            ),
          ),
        };
      });
      if (behaviour || hideSelectionDetails) {
        const selection = changes.find(
          (change) => change.type === "select" && change.selected,
        );
        if (selection?.type === "select") onSelect(selection.id);
        else if (
          behaviour &&
          changes.some(
            (change) => change.type === "select" && change.id === selectedId,
          )
        )
          onClear();
      }
    },
    [behaviour, hideSelectionDetails, nodes, onClear, onSelect, selectedId],
  );
  const connections = useMemo(
    () => graphConnections(nodes, edges, selectedId),
    [nodes, edges, selectedId],
  );
  const selected = nodes.find((node) => node.id === selectedId);
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 gap-3",
        behaviour
          ? "flex-col lg:flex-row lg:overflow-hidden"
          : "overflow-hidden",
        mode === "architecture" && sidePanel && "flex-col md:flex-row",
      )}
    >
      <div
        ref={canvas}
        className={cn(
          "graph-canvas min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border bg-card",
          behaviour && "h-full flex-none lg:flex-1",
        )}
      >
        <ReactFlow<Node, Edge>
          nodes={visibleNodes}
          edges={focused.edges}
          nodeTypes={graphNodeTypes}
          edgeTypes={edgeTypes}
          fitView={!behaviourView}
          minZoom={fitOptions.minZoom}
          maxZoom={2}
          fitViewOptions={fitOptions}
          colorMode="dark"
          panOnScroll={behaviour}
          zoomOnScroll={!behaviour}
          nodesDraggable
          nodesConnectable={false}
          onNodesChange={onNodesChange}
          onInit={(instance) => {
            flow.current = instance;
          }}
          onMoveStart={(event) => {
            if (event) userMoved.current = true;
          }}
          onNodeClick={(_, node) => onSelect(node.id)}
          onNodeDoubleClick={(_, node) => onOpen?.(node.id)}
          onEdgeClick={(_, edge) => onEdgeSelect?.(edge.id)}
          onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
          onNodeMouseLeave={() => setHoveredNodeId(null)}
          onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
          onEdgeMouseLeave={() => setHoveredEdgeId(null)}
          onPaneClick={onClear}
        >
          <Panel position="top-right">
            <div
              className={cn(
                "graph-reading-controls",
                hideSelectionDetails && "graph-reading-controls-compact",
                behaviour && "flex-row!",
              )}
              aria-label="Graph reading controls"
            >
              <Button
                variant="outline"
                size="icon-sm"
                title="Readable zoom"
                aria-label="Readable zoom"
                onClick={() => {
                  userMoved.current = true;
                  void flow.current?.zoomTo(fitOptions.maxZoom, {
                    duration: viewportDuration,
                  });
                }}
              >
                <ZoomIn aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                title="Fit all"
                aria-label="Fit all"
                onClick={() => {
                  userMoved.current = false;
                  void flow.current?.fitView({
                    ...fitOptions,
                    duration: viewportDuration,
                  });
                }}
              >
                <Scan aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                title="Focus selection"
                aria-label="Focus selection"
                disabled={!selected}
                onClick={() => {
                  userMoved.current = true;
                  void flow.current?.fitView({
                    ...fitOptions,
                    nodes: [...connections.ids].map((id) => ({ id })),
                    padding: 0.2,
                    duration: viewportDuration,
                  });
                }}
              >
                <Focus aria-hidden />
              </Button>
              {!hideConnectionFilter && (
                <Button
                  variant={onlyConnections ? "secondary" : "outline"}
                  size="icon-sm"
                  title="Only connections"
                  aria-label="Only connections"
                  disabled={!selected}
                  aria-pressed={Boolean(selected && onlyConnections)}
                  onClick={() => setOnlyConnections((value) => !value)}
                >
                  <Filter aria-hidden />
                </Button>
              )}
            </div>
          </Panel>
          {behaviourView && (
            <BehaviourViewport
              {...behaviourView}
              nodeCount={focused.nodes.length}
              selectedId={selectedId}
              userMoved={userMoved}
            />
          )}
          <Panel position="top-left" className="max-w-[calc(100%-64px)]">
            {behaviour || mode === "architecture" || hideSelectionDetails ? (
              <Collapsible.Root className="group">
                <Collapsible.Trigger asChild>
                  <Button variant="outline" size="sm">
                    Legend
                    <ChevronDown
                      aria-hidden
                      className="group-data-[state=open]:rotate-180"
                    />
                  </Button>
                </Collapsible.Trigger>
                <Collapsible.Content className="mt-1">
                  <GraphLegend mode={mode} />
                </Collapsible.Content>
              </Collapsible.Root>
            ) : (
              <GraphLegend mode={mode} />
            )}
          </Panel>
          <Background gap={24} size={0.7} />
          <Controls showInteractive={false} showFitView={false} />
        </ReactFlow>
      </div>
      {sidePanel}
      {!sidePanel && !hideSelectionDetails && selected && (
        <aside
          aria-label="Selection details"
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border bg-card",
            behaviour
              ? "w-full lg:w-[300px] lg:max-w-[40%]"
              : "w-[340px] max-w-1/2",
          )}
        >
          <div className="flex shrink-0 flex-wrap items-start gap-2 border-b p-4">
            <div className="mr-auto min-w-0">
              <h3 className="break-words text-base font-semibold">
                {behaviour ? String(selected.data.label) : name(selected)}
              </h3>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {behaviour
                  ? name(selected)
                  : String(selected.data.context ?? "")}
              </p>
            </div>
            {onOpen && (
              <Button size="sm" onClick={() => onOpen(selected.id)}>
                {openLabel ?? "Open"}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClear}>
              Clear selection
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 p-4">
              {details}
              {!behaviour && (
                <SelectionConnections
                  connections={connections}
                  onSelect={onSelect}
                  symbols={mode === "symbols"}
                />
              )}
            </div>
          </ScrollArea>
        </aside>
      )}
    </div>
  );
}

function GraphLegend({
  mode,
}: {
  mode: "imports" | "symbols" | "behaviour" | "architecture";
}) {
  return (
    <div aria-label="Graph legend" className="graph-legend">
      {mode !== "behaviour" && (
        <span className="graph-legend-heading">Legend</span>
      )}
      <span>
        <i className="graph-legend-arrow" aria-hidden />
        {mode === "symbols"
          ? "Arrow: imports or calls"
          : mode === "behaviour"
            ? "Source-verified flow"
            : mode === "architecture"
              ? "A → B: A imports or calls B"
              : "A → B: A imports B"}
      </span>
      {mode === "architecture" && (
        <>
          <span>
            <i
              className="graph-legend-swatch graph-swatch-relationship"
              aria-hidden
            />
            Highlighted dependencies
          </span>
          <span>
            <i
              className="graph-legend-arrow graph-legend-relationship-change"
              aria-hidden
            />
            Recent relationship change
          </span>
          <span>
            <i className="graph-legend-swatch graph-swatch-new" aria-hidden />
            New in window
          </span>
          <span>
            <i
              className="graph-legend-swatch graph-swatch-changed"
              aria-hidden
            />
            Changed in window
          </span>
          <span>
            <i
              className="graph-legend-swatch graph-swatch-uncommitted"
              aria-hidden
            />
            Uncommitted edits
          </span>
        </>
      )}
      {mode !== "imports" && mode !== "architecture" && (
        <span>
          <i className="graph-legend-arrow graph-legend-dashed" aria-hidden />
          {mode === "behaviour" ? "Combined steps" : "Dashed: contains"}
        </span>
      )}
      {mode === "behaviour" && (
        <span>
          <i
            className="graph-legend-arrow graph-legend-uncertain"
            aria-hidden
          />
          Unresolved or inferred
        </span>
      )}
      {mode !== "architecture" && (
        <>
          <span>
            <i
              className="graph-legend-swatch graph-swatch-incoming"
              aria-hidden
            />
            Into selection
          </span>
          <span>
            <i
              className="graph-legend-swatch graph-swatch-outgoing"
              aria-hidden
            />
            Out of selection
          </span>
        </>
      )}
      {mode === "behaviour" && <span>Drag or scroll to pan</span>}
    </div>
  );
}

export function SelectionConnections({
  connections,
  onSelect,
  symbols,
  separated = false,
}: {
  connections: ReturnType<typeof graphConnections>;
  onSelect: (id: string) => void;
  symbols: boolean;
  separated?: boolean;
}) {
  return (
    <section
      aria-label="Selected connections"
      className={separated ? "space-y-3" : "space-y-5"}
    >
      <Connections
        title={symbols ? "Points to selection" : "Used by"}
        nodes={connections.incoming}
        onSelect={onSelect}
        direction="incoming"
      />
      {separated && <Separator />}
      <Connections
        title={symbols ? "Selection points to" : "Depends on"}
        nodes={connections.outgoing}
        onSelect={onSelect}
        direction="outgoing"
      />
    </section>
  );
}

function Connections({
  title,
  nodes,
  onSelect,
  direction,
}: {
  title: string;
  nodes: Node[];
  onSelect: (id: string) => void;
  direction: "incoming" | "outgoing";
}) {
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <i
          className={`graph-legend-swatch graph-swatch-${direction}`}
          aria-hidden
        />
        {title} <span className="text-muted-foreground">{nodes.length}</span>
      </h4>
      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">None in this view</p>
      ) : (
        <ul className="space-y-1">
          {nodes.map((node) => (
            <li key={node.id}>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start whitespace-normal break-all py-2 text-left"
                onClick={() => onSelect(node.id)}
              >
                <span>
                  <span className="block">{name(node)}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {String(node.data.context ?? "")}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
