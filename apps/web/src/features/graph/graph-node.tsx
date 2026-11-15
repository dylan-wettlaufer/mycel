import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import type { ChangeAction, NodeKind } from "@mycel/shared";

export type CodeNode = Node<
  {
    label: string;
    name: string;
    context: string;
    kind: NodeKind | "folder";
    detail?: string;
    change?: ChangeAction | undefined;
  },
  "code"
>;

const GraphNode = memo(function GraphNode({ data }: NodeProps<CodeNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
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
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
});
export const graphNodeTypes = { code: GraphNode };
