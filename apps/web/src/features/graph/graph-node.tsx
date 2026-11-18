import { memo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChangeAction, NodeKind } from "@mycel/shared";

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

type StructuralNode = {
  kind: NodeKind | "folder";
  context: string;
  detail?: string;
  change?: ChangeAction | undefined;
  operationKind?: never;
};

type OperationNode = {
  operationKind: OperationKind;
  expansion?: {
    expanded: boolean;
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

const GraphNode = memo(function GraphNode({
  id,
  data,
  targetPosition = Position.Left,
  sourcePosition = Position.Right,
}: NodeProps<CodeNode>) {
  return (
    <>
      <Handle type="target" position={targetPosition} isConnectable={false} />
      {data.operationKind ? (
        <div
          className="operation-node-content"
          title={`${data.label}\n${data.name}`}
        >
          <div className="operation-node-title">{data.label}</div>
          <code className="operation-node-identifier">{data.name}</code>
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
                {data.expansion.expanded ? "Hide steps" : "Show steps"}
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
      <Handle type="source" position={sourcePosition} isConnectable={false} />
    </>
  );
});
export const graphNodeTypes = { code: GraphNode };
