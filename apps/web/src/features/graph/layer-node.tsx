import { memo } from "react";
import {
  Braces,
  CircleHelp,
  Database,
  Layers,
  Monitor,
  Server,
  type LucideIcon,
} from "lucide-react";
import type { Node, NodeProps } from "@xyflow/react";
import type { ArchitectureLayer } from "@/features/semantic/behaviour-architecture";

const layerDetails: Record<
  ArchitectureLayer,
  { title: string; role: string; icon: LucideIcon }
> = {
  interface: { title: "UI", role: "Frontend", icon: Monitor },
  api: { title: "API", role: "Backend", icon: Server },
  logic: { title: "Functions", role: "Shared code", icon: Braces },
  service: { title: "Services", role: "Business logic", icon: Layers },
  data: { title: "Data", role: "Persistence", icon: Database },
  unresolved: { title: "Unresolved", role: "Not followed", icon: CircleHelp },
};

export type LayerNode = Node<
  {
    layer: ArchitectureLayer;
    count: number;
    location?: string | undefined;
    /** Keeps the header clear of links entering the first card from above. */
    inset?: number | undefined;
  },
  "layer"
>;

export const LayerNodeView = memo(function LayerNodeView({
  data,
}: NodeProps<LayerNode>) {
  const { title, role, icon: Icon } = layerDetails[data.layer];
  return (
    <div
      className="layer-node"
      style={data.inset ? { paddingLeft: data.inset } : undefined}
      title={`${title} (${role}): ${data.count} ${data.count === 1 ? "part" : "parts"}${data.location ? ` in ${data.location}` : ""}`}
    >
      <span className="layer-node-icon" aria-hidden>
        <Icon />
      </span>
      <div className="min-w-0 flex-1">
        <div className="layer-node-title">
          {title} <span className="layer-node-role">({role})</span>
        </div>
        {data.location && (
          <div className="layer-node-location">{data.location}</div>
        )}
      </div>
    </div>
  );
});
