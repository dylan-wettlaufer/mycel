import dagre from "@dagrejs/dagre";
import {
  MarkerType,
  Position,
  type Edge,
  type XYPosition,
} from "@xyflow/react";
import type {
  ArchitectureConnectionWithChanges,
  ArchitectureMap,
} from "@mycel/shared";
import type { NodeHandle } from "@/features/graph/graph-node";
import type { PartNode } from "./part-node";

export const partNodeSize = { width: 272, height: 124 };
const gapOffsets = [0, 14, -14, 28, -28];
const backLaneStartOffset = 44;
const backLaneSpacing = 22;

function handleId(type: NodeHandle["type"], position: Position) {
  return `${type}-${position}`;
}

function connectionLabel(
  connection: ArchitectureConnectionWithChanges,
): string {
  if (connection.importCount > 0 && connection.callCount > 0) {
    return `${connection.count} links`;
  }
  if (connection.importCount > 0) {
    return `${connection.importCount} ${connection.importCount === 1 ? "import" : "imports"}`;
  }
  return `${connection.callCount} ${connection.callCount === 1 ? "call" : "calls"}`;
}

function connectionDescription(
  connection: ArchitectureConnectionWithChanges,
): string {
  const parts: string[] = [];
  if (connection.importCount > 0) {
    parts.push(
      `${connection.importCount} ${connection.importCount === 1 ? "import" : "imports"}`,
    );
  }
  if (connection.callCount > 0) {
    parts.push(
      `${connection.callCount} ${connection.callCount === 1 ? "call" : "calls"}`,
    );
  }
  const change =
    connection.change.status === "unchanged"
      ? ""
      : ` (${connection.change.status}${connection.change.uncommitted ? ", uncommitted" : ""})`;
  return `${connection.sourcePartId} → ${connection.targetPartId}: ${parts.join(", ")}${change}`;
}

function anchorPoint(position: XYPosition, side: Position): XYPosition {
  const { width, height } = partNodeSize;
  switch (side) {
    case Position.Left:
      return { x: position.x, y: position.y + height / 2 };
    case Position.Right:
      return { x: position.x + width, y: position.y + height / 2 };
    case Position.Top:
      return { x: position.x + width / 2, y: position.y };
    case Position.Bottom:
      return { x: position.x + width / 2, y: position.y + height };
  }
}

export function layoutArchitectureMap(map: ArchitectureMap): {
  nodes: PartNode[];
  edges: Edge[];
} {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: 56,
    ranksep: 128,
    edgesep: 28,
  });

  for (const part of map.parts) {
    graph.setNode(part.id, { ...partNodeSize });
  }
  for (const connection of map.connections) {
    graph.setEdge(connection.sourcePartId, connection.targetPartId);
  }
  dagre.layout(graph);

  const positions = new Map<string, XYPosition>();
  let maxBottom = 0;
  for (const part of map.parts) {
    const placed = graph.node(part.id);
    const position = {
      x: Math.round(placed.x - partNodeSize.width / 2),
      y: Math.round(placed.y - partNodeSize.height / 2),
    };
    positions.set(part.id, position);
    maxBottom = Math.max(maxBottom, position.y + partNodeSize.height);
  }

  const handlesByPart = new Map<string, Map<string, NodeHandle>>();
  function registerHandle(
    partId: string,
    type: NodeHandle["type"],
    position: Position,
  ): string {
    const id = handleId(type, position);
    let mapForPart = handlesByPart.get(partId);
    if (!mapForPart) {
      mapForPart = new Map();
      handlesByPart.set(partId, mapForPart);
    }
    mapForPart.set(id, { id, type, position });
    return id;
  }

  const gapUseCounts = new Map<number, number>();
  let backLaneIndex = 0;

  const edges: Edge[] = map.connections.map((connection) => {
    const sourcePos = positions.get(connection.sourcePartId)!;
    const targetPos = positions.get(connection.targetPartId)!;
    const forward = targetPos.x >= sourcePos.x + partNodeSize.width - 12;

    let sourceSide: Position;
    let targetSide: Position;
    let bends: XYPosition[];
    let label: XYPosition;

    if (forward) {
      sourceSide = Position.Right;
      targetSide = Position.Left;
      const start = anchorPoint(sourcePos, sourceSide);
      const end = anchorPoint(targetPos, targetSide);
      const midX = Math.round((start.x + end.x) / 2);
      const bucket = Math.round(midX / 40);
      const uses = gapUseCounts.get(bucket) ?? 0;
      gapUseCounts.set(bucket, uses + 1);
      const bendX = midX + gapOffsets[uses % gapOffsets.length]!;
      if (Math.abs(start.y - end.y) <= 4) {
        bends = [];
        label = { x: bendX, y: start.y };
      } else {
        bends = [
          { x: bendX, y: start.y },
          { x: bendX, y: end.y },
        ];
        label = { x: bendX, y: Math.round((start.y + end.y) / 2) };
      }
    } else {
      // Same-column or backward edge: route cleanly underneath cards to avoid overlaps.
      sourceSide = Position.Bottom;
      targetSide = Position.Bottom;
      const start = anchorPoint(sourcePos, sourceSide);
      const end = anchorPoint(targetPos, targetSide);
      const laneY =
        maxBottom + backLaneStartOffset + backLaneSpacing * backLaneIndex++;
      bends = [
        { x: start.x, y: laneY },
        { x: end.x, y: laneY },
      ];
      label = { x: Math.round((start.x + end.x) / 2), y: laneY };
    }

    const start = anchorPoint(sourcePos, sourceSide);
    const end = anchorPoint(targetPos, targetSide);
    const sourceHandle = registerHandle(
      connection.sourcePartId,
      "source",
      sourceSide,
    );
    const targetHandle = registerHandle(
      connection.targetPartId,
      "target",
      targetSide,
    );

    const statusClass =
      connection.change.status === "new"
        ? "arch-edge-new"
        : connection.change.status === "changed"
          ? "arch-edge-changed"
          : "";
    const uncommittedClass = connection.change.uncommitted
      ? "arch-edge-uncommitted"
      : "";

    const color =
      connection.change.status === "new"
        ? "var(--success)"
        : connection.change.status === "changed"
          ? "var(--warning)"
          : "var(--muted-foreground)";

    return {
      id: connection.id,
      type: "behaviour",
      source: connection.sourcePartId,
      target: connection.targetPartId,
      sourceHandle,
      targetHandle,
      label: connectionLabel(connection),
      className: [statusClass, uncommittedClass].filter(Boolean).join(" "),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 18,
        height: 18,
      },
      style: {
        stroke: color,
        strokeWidth: connection.change.uncommitted ? 2.8 : 2,
      },
      data: {
        route: { source: start, target: end, bends, label },
        description: connectionDescription(connection),
        connectionId: connection.id,
        changeStatus: connection.change.status,
        uncommitted: connection.change.uncommitted,
      },
    };
  });

  const nodes: PartNode[] = map.parts.map((part) => {
    const position = positions.get(part.id)!;
    const handles = handlesByPart.get(part.id);
    const classes = [
      "arch-part-node",
      `arch-part-kind-${part.kind}`,
      part.change.status === "new"
        ? "arch-part-new"
        : part.change.status === "changed"
          ? "arch-part-changed"
          : "",
      part.change.uncommitted ? "arch-part-uncommitted" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return {
      id: part.id,
      type: "part",
      position,
      className: classes,
      style: partNodeSize,
      ariaLabel: `${part.name}, ${part.kind}, ${part.files.length} files`,
      data: {
        label: part.name,
        name: part.name,
        purpose: part.purpose,
        kind: part.kind,
        fileCount: part.files.length,
        status: part.change.status,
        uncommitted: part.change.uncommitted,
        ...(part.fallback ? { fallback: true } : {}),
        ...(handles ? { handles: [...handles.values()] } : {}),
      },
    };
  });

  return { nodes, edges };
}
