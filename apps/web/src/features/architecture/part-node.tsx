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
import { Badge } from "@/components/ui/badge";
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
    { id: "target-left", type: "target" as const, position: Position.Left },
    { id: "source-right", type: "source" as const, position: Position.Right },
  ];
  const Icon = partKindIcons[data.kind];
  const updateNodeInternals = useUpdateNodeInternals();
  const handleKey = handles.map((handle) => handle.id).join(",");

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleKey, updateNodeInternals]);

  const fileLabel = `${data.fileCount} ${data.fileCount === 1 ? "file" : "files"}`;
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
          <span className="part-node-icon" aria-hidden>
            <Icon />
          </span>
          <Badge variant="outline" className="part-node-kind">
            {partKindLabel(data.kind)}
          </Badge>
          <span className="part-node-count">{fileLabel}</span>
          {(statusLabel || data.uncommitted) && (
            <span className="part-node-changes">
              {statusLabel && (
                <Badge
                  variant="outline"
                  className={`part-change-badge part-change-${data.status}`}
                >
                  {statusLabel}
                </Badge>
              )}
              {data.uncommitted && (
                <span
                  className="part-uncommitted-dot"
                  title="Uncommitted changes"
                  aria-label="Uncommitted changes"
                />
              )}
            </span>
          )}
        </div>
        <div className="part-node-title">{data.name}</div>
        <p className="part-node-purpose">{data.purpose}</p>
        {data.usedBy !== undefined && (
          <p className="part-node-used-by">
            Used by {data.usedBy} {data.usedBy === 1 ? "part" : "parts"}
          </p>
        )}
      </div>
    </>
  );
});
