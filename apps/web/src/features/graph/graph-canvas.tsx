import { useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
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
      <div className="flex flex-wrap gap-2" aria-label="Graph reading controls">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void flow.current?.zoomTo(1, { duration: 200 });
          }}
        >
          Readable zoom
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void flow.current?.fitView({
              minZoom: 0.03,
              maxZoom: 1,
              padding: 0.15,
              duration: 200,
            });
          }}
        >
          Fit all
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!selected}
          onClick={() => {
            void flow.current?.fitView({
              nodes: [...connections.ids].map((id) => ({ id })),
              minZoom: 0.75,
              maxZoom: 1,
              padding: 0.2,
              duration: 200,
            });
          }}
        >
          Focus selection
        </Button>
        <Button
          variant={onlyConnections ? "secondary" : "outline"}
          size="sm"
          disabled={!selected}
          aria-pressed={Boolean(selected && onlyConnections)}
          onClick={() => setOnlyConnections((value) => !value)}
        >
          Only connections
        </Button>
      </div>
      <div aria-label="Graph legend" className="graph-legend">
        <span>
          <i className="graph-legend-arrow" aria-hidden />A → B:{" "}
          {symbols ? "A imports, calls, or contains B" : "A imports B"}
        </span>
        {symbols && (
          <span>
            <i className="graph-legend-arrow graph-legend-dashed" aria-hidden />
            Dashed: contains a declaration
          </span>
        )}
        <span>
          <i
            className="graph-legend-swatch graph-swatch-incoming"
            aria-hidden
          />
          Blue: points to selection
        </span>
        <span>
          <i
            className="graph-legend-swatch graph-swatch-outgoing"
            aria-hidden
          />
          Green: selection points to
        </span>
      </div>
      <div className="graph-canvas h-[600px] overflow-hidden rounded-lg border bg-card">
        <ReactFlow<Node, Edge>
          nodes={focused.nodes}
          edges={focused.edges}
          nodeTypes={graphNodeTypes}
          fitView
          minZoom={0.03}
          maxZoom={2}
          fitViewOptions={{ padding: 0.12, minZoom: 0.75, maxZoom: 1 }}
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
          <Background gap={24} size={0.7} />
          <Controls showInteractive={false} showFitView={false} />
        </ReactFlow>
      </div>
      <p className="text-xs text-muted-foreground">
        Click a node to trace its direct connections. Pan to explore; Fit all
        shows the full map at a smaller scale.
        {onOpen ? " Double-click a node to open it." : ""}
      </p>
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
