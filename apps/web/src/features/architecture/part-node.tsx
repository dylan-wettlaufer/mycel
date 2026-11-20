import { memo, useEffect } from "react";
import {
  AppWindow,
  Database,
  Package,
  Plug,
  Server,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type {
  ArchitectureChangeStatus,
  ArchitecturePartKind,
} from "@mycel/shared";
import type { NodeHandle } from "@/features/graph/graph-node";

const partKindLabels: Record<ArchitecturePartKind, string> = {
  app: "App",
  service: "Service",
  library: "Library",
  data: "Data",
  integration: "Integration",
  cli: "CLI",
};

const partKindIcons: Record<ArchitecturePartKind, LucideIcon> = {
  app: AppWindow,
  service: Server,
  library: Package,
  data: Database,
  integration: Plug,
  cli: Terminal,
};

export interface PartNodeData extends Record<string, unknown> {
  label: string;
  name: string;
  purpose: string;
  kind: ArchitecturePartKind;
  fileCount: number;
  status: ArchitectureChangeStatus;
  uncommitted: boolean;
  /** Set for foundation parts, whose incoming lines are hidden until focused. */
  usedBy?: number;
  fallback?: boolean;
  boundary?: boolean;
  handles?: NodeHandle[];
}

export type PartNode = Node<PartNodeData, "part">;

export function partKindLabel(kind: ArchitecturePartKind): string {
  return partKindLabels[kind];
}

export const PartNodeView = memo(function PartNodeView({
  id,
  data,
}: NodeProps<PartNode>) {
  const handles = data.handles ?? [
    { id: "target-top", type: "target" as const, position: Position.Top },
    { id: "source-bottom", type: "source" as const, position: Position.Bottom },
  ];
  const Icon = partKindIcons[data.kind];
  const updateNodeInternals = useUpdateNodeInternals();
  const handleKey = handles
    .map(({ id, position, offset }) => `${id}:${position}:${offset}`)
    .join(",");

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleKey, updateNodeInternals]);

  const statusLabel =
    data.status === "new"
      ? "New"
      : data.status === "changed"
        ? "Changed"
        : undefined;

  return (
    <>
      {handles.map((handle) => {
        const style =
          handle.offset === undefined
            ? undefined
            : handle.position === Position.Left ||
                handle.position === Position.Right
              ? { top: `${handle.offset}%` }
              : { left: `${handle.offset}%` };
        return (
          <Handle
            key={handle.id}
            id={handle.id}
            type={handle.type}
            position={handle.position}
            style={style}
            isConnectable={false}
          />
        );
      })}
      <div
        className="part-node-content"
        title={`${data.name} (${partKindLabel(data.kind)})\n${data.purpose}`}
      >
        <div className="part-node-header">
          <div className="part-node-title">{data.name}</div>
          {(statusLabel || data.uncommitted) && (
            <span
              className={`part-node-status part-node-status-${data.status}${data.uncommitted ? " part-node-status-dirty" : ""}`}
              title={[
                statusLabel,
                data.uncommitted ? "Uncommitted changes" : undefined,
              ]
                .filter(Boolean)
                .join(", ")}
              aria-hidden
            />
          )}
        </div>
        <p className="part-node-purpose">{data.purpose}</p>
        <div className="part-node-meta">
          <Icon aria-hidden />
          <span>
            {data.boundary ? "External component · " : ""}
            {data.fileCount} {data.fileCount === 1 ? "file" : "files"}
          </span>
        </div>
      </div>
    </>
  );
});
