import { memo, useEffect } from "react";
import {
  Box,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Database,
  MousePointerClick,
  Send,
  Server,
  SquareFunction,
  Table2,
  type LucideIcon,
} from "lucide-react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChangeAction, NodeKind } from "@mycel/shared";
import { LayerNodeView } from "./layer-node";

const operationKinds = {
  event: "UI Event",
  endpoint: "API Endpoint",
  request: "HTTP Request",
  service: "Service",
  function: "Function",
  data: "Data Operation",
  model: "Data Model",
  unresolved: "Unresolved",
} as const;

export type OperationKind = keyof typeof operationKinds;

const operationIcons: Record<OperationKind, LucideIcon> = {
  event: MousePointerClick,
  endpoint: Server,
  request: Send,
  service: Box,
  function: SquareFunction,
  data: Database,
  model: Table2,
  unresolved: CircleHelp,
};

export type NodeHandle = {
  id: string;
  type: "source" | "target";
  position: Position;
};

type StructuralNode = {
  kind: NodeKind | "folder";
  context: string;
  detail?: string;
  change?: ChangeAction | undefined;
  operationKind?: never;
};

type OperationNode = {
  operationKind: OperationKind;
  location?: string;
  handles?: NodeHandle[];
  expansion?: {
    expanded: boolean;
    steps?: number | undefined;
    onToggle: (id: string) => void;
  };
};

export type CodeNode = Node<
  {
    label: string;
    name: string;
  } & (StructuralNode | OperationNode),
  "code"
>;

export function operationKindLabel(kind: OperationKind) {
  return operationKinds[kind];
}

function stepsLabel({
  expanded,
  steps,
}: NonNullable<OperationNode["expansion"]>) {
  if (expanded) return "Hide steps";
  return steps ? `${steps} ${steps === 1 ? "step" : "steps"}` : "Show steps";
}

const GraphNode = memo(function GraphNode({
  id,
  data,
  targetPosition = Position.Left,
  sourcePosition = Position.Right,
}: NodeProps<CodeNode>) {
  const handles = data.operationKind
    ? data.handles
    : [
        { id: "target", type: "target", position: targetPosition } as const,
        { id: "source", type: "source", position: sourcePosition } as const,
      ];
  const Icon = data.operationKind && operationIcons[data.operationKind];
  const updateNodeInternals = useUpdateNodeInternals();
  const handleKey = handles?.map((handle) => handle.id).join() ?? "";
  // React Flow only measures handles on mount and resize.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleKey, updateNodeInternals]);
  return (
    <>
      {handles?.map((handle) => (
        <Handle
          key={handle.id}
          id={data.operationKind ? handle.id : null}
          type={handle.type}
          position={handle.position}
          isConnectable={false}
        />
      ))}
      {data.operationKind ? (
        <div
          className="operation-node-content"
          title={`${data.label}\n${data.name}${data.location ? `\n${data.location}` : ""}`}
        >
          <div className="flex min-w-0 items-start gap-2 self-stretch">
            {Icon && (
              <span className="operation-node-icon" aria-hidden>
                <Icon />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="operation-node-title">{data.label}</div>
              <code className="operation-node-identifier">{data.name}</code>
              {data.location && (
                <div className="operation-node-location">{data.location}</div>
              )}
            </div>
          </div>
          <div className="mt-auto flex w-full items-center justify-between gap-1">
            <Badge variant="ghost" className="operation-node-type">
              {operationKindLabel(data.operationKind)}
            </Badge>
            {data.expansion && (
              <Button
                variant="outline"
                size="xs"
                className="nodrag nopan gap-0.5 has-[>svg]:px-1"
                aria-label={`${data.expansion.expanded ? "Hide" : "Show"} call steps for ${data.name}`}
                aria-expanded={data.expansion.expanded}
                onClick={(event) => {
                  event.stopPropagation();
                  data.expansion?.onToggle(id);
                }}
                onKeyDown={(event) => event.stopPropagation()}
              >
                {data.expansion.expanded ? (
                  <ChevronUp aria-hidden />
                ) : (
                  <ChevronDown aria-hidden />
                )}
                {stepsLabel(data.expansion)}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div
          className="graph-node-content"
          title={`${data.name}\n${data.context}`}
        >
          <div className="graph-node-meta">
            <Badge
              variant="outline"
              className={`graph-kind graph-kind-${data.kind}`}
            >
              {data.kind}
            </Badge>
            {data.detail && <span>{data.detail}</span>}
            {data.change && (
              <span className={`graph-change graph-change-${data.change}`}>
                {data.change}
              </span>
            )}
          </div>
          <div className="graph-node-title">{data.name}</div>
          <div className="graph-node-context">{data.context}</div>
        </div>
      )}
    </>
  );
});
export const graphNodeTypes = { code: GraphNode, layer: LayerNodeView };
