import { Focus, Filter, Scan, ZoomIn } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { graphNodeTypes } from "./graph-node";
import { focusGraph, graphConnections } from "./graph-focus";

const fitViewOptions = { padding: 0.15, minZoom: 0.03, maxZoom: 0.8 };
const behaviourFitViewOptions = { ...fitViewOptions, maxZoom: 1 };

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

export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  onClear,
  onOpen,
  openLabel,
  mode = "imports",
  initialFocusId,
  details,
}: {
  nodes: Node[];
  edges: Edge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  onOpen?: ((id: string) => void) | undefined;
  openLabel?: string;
  mode?: "imports" | "symbols" | "behaviour";
  initialFocusId?: string | undefined;
  details?: ReactNode;
}) {
  const [onlyConnections, setOnlyConnections] = useState(false);
  const [nodeState, setNodeState] = useState(() => new Map<string, Node>());
  const flow = useRef<ReactFlowInstance | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const behaviour = mode === "behaviour";
  const fitOptions = behaviour ? behaviourFitViewOptions : fitViewOptions;
  const initialFitOptions = useMemo(() => {
    if (!initialFocusId) return fitOptions;
    const entry = graphConnections(nodes, edges, initialFocusId);
    const nearby = new Set(entry.ids);
    for (const next of entry.outgoing)
      for (const node of graphConnections(nodes, edges, next.id).outgoing)
        nearby.add(node.id);
    return { ...fitOptions, nodes: [...nearby].map((id) => ({ id })) };
  }, [fitOptions, initialFocusId, nodes, edges]);
  useEffect(() => {
    const element = canvas.current;
    // Expanded traces open at their entry point and keep their zoom on resize.
    if (!behaviour || !element || initialFocusId) return;
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
  }, [behaviour, fitOptions, initialFocusId]);
  const focused = useMemo(
    () => focusGraph(nodes, edges, selectedId, onlyConnections),
    [nodes, edges, selectedId, onlyConnections],
  );
  const visibleNodes = useMemo(
    () => withNodeState(focused.nodes, nodeState),
    [focused.nodes, nodeState],
  );
  const onNodesChange = useCallback<OnNodesChange>(
    (changes) => {
      setNodeState(
        (previous) =>
          new Map(
            applyNodeChanges(changes, withNodeState(nodes, previous)).map(
              (node) => [node.id, node],
            ),
          ),
      );
      if (behaviour) {
        const selection = changes.find(
          (change) => change.type === "select" && change.selected,
        );
        if (selection?.type === "select") onSelect(selection.id);
        else if (
          changes.some(
            (change) => change.type === "select" && change.id === selectedId,
          )
        )
          onClear();
      }
    },
    [behaviour, nodes, onClear, onSelect, selectedId],
  );
  const connections = useMemo(
    () => graphConnections(nodes, edges, selectedId),
    [nodes, edges, selectedId],
  );
  const selected = nodes.find((node) => node.id === selectedId);
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden",
        behaviour && "flex-col lg:flex-row",
      )}
    >
      <div
        ref={canvas}
        className={cn(
          "graph-canvas min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border bg-card",
          behaviour &&
            "h-[min(30rem,58dvh)] min-h-72 flex-none lg:h-auto lg:flex-1",
        )}
      >
        <ReactFlow<Node, Edge>
          nodes={visibleNodes}
          edges={focused.edges}
          nodeTypes={graphNodeTypes}
          fitView
          minZoom={0.03}
          maxZoom={2}
          fitViewOptions={initialFitOptions}
          colorMode="dark"
          nodesDraggable
          nodesConnectable={false}
          onNodesChange={onNodesChange}
          onInit={(instance) => {
            flow.current = instance;
          }}
          onNodeClick={(_, node) => onSelect(node.id)}
          onNodeDoubleClick={(_, node) => onOpen?.(node.id)}
          onPaneClick={onClear}
        >
          <Panel position="top-right">
            <div
              className="graph-reading-controls"
              aria-label="Graph reading controls"
            >
              <Button
                variant="outline"
                size="icon-sm"
                title="Readable zoom"
                aria-label="Readable zoom"
                onClick={() => {
                  void flow.current?.zoomTo(fitOptions.maxZoom, {
                    duration: 200,
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
                  void flow.current?.fitView({
                    ...fitOptions,
                    duration: 200,
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
                  void flow.current?.fitView({
                    ...fitOptions,
                    nodes: [...connections.ids].map((id) => ({ id })),
                    padding: 0.2,
                    duration: 200,
                  });
                }}
              >
                <Focus aria-hidden />
              </Button>
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
            </div>
          </Panel>
          <Panel
            position="top-left"
            className={
              behaviour ? "max-w-[calc(100%-64px)] hidden sm:block" : undefined
            }
          >
            <div aria-label="Graph legend" className="graph-legend">
              <span className="graph-legend-heading">Legend</span>
              <span>
                <i className="graph-legend-arrow" aria-hidden />
                {mode === "symbols"
                  ? "Arrow: imports or calls"
                  : behaviour
                    ? "Arrow follows the flow"
                    : "A → B: A imports B"}
              </span>
              {mode !== "imports" && (
                <span>
                  <i
                    className="graph-legend-arrow graph-legend-dashed"
                    aria-hidden
                  />
                  {behaviour ? "Dashed: combined steps" : "Dashed: contains"}
                </span>
              )}
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
            </div>
          </Panel>
          <Background gap={24} size={0.7} />
          <Controls showInteractive={false} showFitView={false} />
        </ReactFlow>
      </div>
      {selected && (
        <aside
          aria-label="Selection details"
          className={
            behaviour
              ? "flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-lg border bg-card lg:w-[300px] lg:max-w-[40%]"
              : "absolute inset-y-0 right-0 z-10 flex w-[340px] max-w-full min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border bg-card shadow-lg lg:static lg:shadow-none"
          }
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
                <section
                  aria-label="Selected connections"
                  className="space-y-5"
                >
                  <Connections
                    title={
                      mode === "symbols" ? "Points to selection" : "Used by"
                    }
                    nodes={connections.incoming}
                    onSelect={onSelect}
                    direction="incoming"
                  />
                  <Connections
                    title={
                      mode === "symbols" ? "Selection points to" : "Depends on"
                    }
                    nodes={connections.outgoing}
                    onSelect={onSelect}
                    direction="outgoing"
                  />
                </section>
              )}
            </div>
          </ScrollArea>
        </aside>
      )}
    </div>
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
