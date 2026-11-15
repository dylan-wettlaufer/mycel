import { Focus, Filter, Scan, ZoomIn } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { graphNodeTypes } from "./graph-node";
import { focusGraph, graphConnections } from "./graph-focus";

function name(node: Node): string {
  return String(node.data.name ?? node.data.label);
}
export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  onClear,
  onOpen,
  openLabel,
  symbols = false,
}: {
  nodes: Node[];
  edges: Edge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  onOpen?: ((id: string) => void) | undefined;
  openLabel?: string;
  symbols?: boolean;
}) {
  const [onlyConnections, setOnlyConnections] = useState(false);
  const flow = useRef<ReactFlowInstance | null>(null);
  const focused = useMemo(
    () => focusGraph(nodes, edges, selectedId, onlyConnections),
    [nodes, edges, selectedId, onlyConnections],
  );
  const connections = useMemo(
    () => graphConnections(nodes, edges, selectedId),
    [nodes, edges, selectedId],
  );
  const selected = nodes.find((node) => node.id === selectedId);
  return (
    <div className="space-y-3">
      <div className="graph-canvas h-[70svh] min-h-[400px] max-h-[900px] overflow-hidden rounded-lg border bg-card">
        <ReactFlow<Node, Edge>
          nodes={focused.nodes}
          edges={focused.edges}
          nodeTypes={graphNodeTypes}
          fitView
          minZoom={0.03}
          maxZoom={2}
          fitViewOptions={{ padding: 0.15, minZoom: 0.03, maxZoom: 0.8 }}
          colorMode="dark"
          nodesDraggable={false}
          nodesConnectable={false}
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
                  void flow.current?.zoomTo(0.8, { duration: 200 });
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
                    minZoom: 0.03,
                    maxZoom: 0.8,
                    padding: 0.15,
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
                    nodes: [...connections.ids].map((id) => ({ id })),
                    minZoom: 0.03,
                    maxZoom: 0.8,
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
          <Panel position="top-left">
            <div aria-label="Graph legend" className="graph-legend">
              <span className="graph-legend-heading">Legend</span>
              <span>
                <i className="graph-legend-arrow" aria-hidden />
                {symbols ? "Arrow: imports or calls" : "A → B: A imports B"}
              </span>
              {symbols && (
                <span>
                  <i
                    className="graph-legend-arrow graph-legend-dashed"
                    aria-hidden
                  />
                  Dashed: contains
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
        <section
          aria-label="Selected connections"
          className="rounded-lg border bg-card p-4"
        >
          <div className="mb-4 flex flex-wrap items-start gap-2">
            <div className="mr-auto min-w-0">
              <h3 className="break-all text-base font-semibold">
                {name(selected)}
              </h3>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {String(selected.data.context ?? "")}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Connections
              title={symbols ? "Points to selection" : "Used by"}
              nodes={connections.incoming}
              onSelect={onSelect}
              direction="incoming"
            />
            <Connections
              title={symbols ? "Selection points to" : "Depends on"}
              nodes={connections.outgoing}
              onSelect={onSelect}
              direction="outgoing"
            />
          </div>
        </section>
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
        <ul className="max-h-52 space-y-1 overflow-y-auto">
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
