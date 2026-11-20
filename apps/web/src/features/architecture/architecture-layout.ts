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

export const partNodeSize = { width: 280, height: 128 };

const nodePadding = 28;
const trackSpacing = 34;
const minVerticalSeparation = 28;
const minHorizontalSeparation = 36;
const highwayOffset = 58;
const highwaySpacing = 42;
const labelHalfWidth = 46;
const labelHalfHeight = 16;

interface Rect {
  id?: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Segment {
  edgeId: string;
  a: XYPosition;
  b: XYPosition;
}

/** Connections with at most this many imports and calls are hidden unless requested. */
export const minorConnectionMaxCount = 2;

export interface ArchitectureLayoutOptions {
  showMinor?: boolean;
}

/** One drawn line: a connection, or two opposite connections merged. */
interface DisplayConnection {
  id: string;
  sourcePartId: string;
  targetPartId: string;
  connections: ArchitectureConnectionWithChanges[];
  status: ArchitectureConnectionWithChanges["change"]["status"];
  uncommitted: boolean;
  foundation: boolean;
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

function displayLabel(display: DisplayConnection): string {
  const [forward, backward] = display.connections;
  return backward
    ? `${connectionLabel(forward!)} → · ${connectionLabel(backward)} ←`
    : connectionLabel(forward!);
}

/** Stroke width grows with the logarithm of the link count. */
export function connectionWeight(count: number): number {
  return Math.min(6, Math.round((1.25 + 1.25 * Math.log2(count)) * 4) / 4);
}

/**
 * Parts that most other parts use and that depend on no other part, such as
 * shared contracts. Their lines carry little information, so they are pinned
 * below the map and drawn only when focused.
 */
export function findFoundationParts(map: ArchitectureMap): Set<string> {
  const others = map.parts.length - 1;
  if (others < 4) return new Set();
  const users = new Map<string, Set<string>>();
  const dependents = new Set<string>();
  for (const { sourcePartId, targetPartId } of map.connections) {
    if (sourcePartId === targetPartId) continue;
    dependents.add(sourcePartId);
    users.set(
      targetPartId,
      (users.get(targetPartId) ?? new Set()).add(sourcePartId),
    );
  }
  const threshold = Math.max(3, Math.ceil(others * 0.6));
  return new Set(
    map.parts
      .filter(
        (part) =>
          !dependents.has(part.id) &&
          (users.get(part.id)?.size ?? 0) >= threshold,
      )
      .map((part) => part.id),
  );
}

function displayConnections(
  map: ArchitectureMap,
  foundation: ReadonlySet<string>,
  showMinor: boolean,
): { displays: DisplayConnection[]; hiddenMinorCount: number } {
  const visible = map.connections.filter(
    (connection) => showMinor || connection.count > minorConnectionMaxCount,
  );
  const byPair = new Map<string, ArchitectureConnectionWithChanges>();
  for (const connection of visible) {
    byPair.set(
      `${connection.sourcePartId}\0${connection.targetPartId}`,
      connection,
    );
  }
  const merged = new Set<string>();
  const displays: DisplayConnection[] = [];
  for (const connection of visible) {
    if (merged.has(connection.id)) continue;
    const reverse = byPair.get(
      `${connection.targetPartId}\0${connection.sourcePartId}`,
    );
    const pair =
      reverse && reverse.id !== connection.id
        ? [connection, reverse].sort((a, b) => b.count - a.count)
        : [connection];
    for (const entry of pair) merged.add(entry.id);
    const primary = pair[0]!;
    const statuses = pair.map((entry) => entry.change.status);
    displays.push({
      id: primary.id,
      sourcePartId: primary.sourcePartId,
      targetPartId: primary.targetPartId,
      connections: pair,
      status: statuses.includes("new")
        ? "new"
        : statuses.includes("changed")
          ? "changed"
          : "unchanged",
      uncommitted: pair.some((entry) => entry.change.uncommitted),
      foundation:
        foundation.has(primary.sourcePartId) ||
        foundation.has(primary.targetPartId),
    });
  }
  return {
    displays,
    hiddenMinorCount: map.connections.length - visible.length,
  };
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

function distributedOffset(index: number, total: number): number {
  if (total <= 1) return 50;
  const span = Math.min(76, 24 * (total - 1));
  const start = 50 - span / 2;
  return Math.round(start + (span * index) / (total - 1));
}

function anchorPoint(
  position: XYPosition,
  side: Position,
  offset = 50,
): XYPosition {
  const { width, height } = partNodeSize;
  const fraction = offset / 100;
  switch (side) {
    case Position.Left:
      return { x: position.x, y: Math.round(position.y + height * fraction) };
    case Position.Right:
      return {
        x: position.x + width,
        y: Math.round(position.y + height * fraction),
      };
    case Position.Top:
      return { x: Math.round(position.x + width * fraction), y: position.y };
    case Position.Bottom:
      return {
        x: Math.round(position.x + width * fraction),
        y: position.y + height,
      };
  }
}

function segmentHitsRect(a: XYPosition, b: XYPosition, rect: Rect): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return (
    maxX > rect.left &&
    minX < rect.right &&
    maxY > rect.top &&
    minY < rect.bottom
  );
}

function pathHitsAnyBox(
  points: readonly XYPosition[],
  boxes: readonly Rect[],
  ignoreIds: ReadonlySet<string>,
): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (const box of boxes) {
      if (box.id && ignoreIds.has(box.id)) continue;
      if (segmentHitsRect(a, b, box)) return true;
    }
  }
  return false;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

function labelRect(point: XYPosition): Rect {
  return {
    left: point.x - labelHalfWidth,
    right: point.x + labelHalfWidth,
    top: point.y - labelHalfHeight,
    bottom: point.y + labelHalfHeight,
  };
}

function placeClearLabel(
  edgeId: string,
  routePoints: readonly XYPosition[],
  preferred: XYPosition,
  nodeBoxes: readonly Rect[],
  placedLabels: Rect[],
  allSegments: readonly Segment[],
): XYPosition {
  const candidates: XYPosition[] = [preferred];

  // Probe candidate positions along every straight segment, longest first.
  const segments: { a: XYPosition; b: XYPosition; length: number }[] = [];
  for (let i = 0; i + 1 < routePoints.length; i++) {
    const a = routePoints[i]!;
    const b = routePoints[i + 1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length >= 60) segments.push({ a, b, length });
  }
  segments.sort((u, v) => v.length - u.length);

  for (const { a, b } of segments) {
    for (const t of [0.5, 0.35, 0.65, 0.25, 0.75, 0.2, 0.8]) {
      candidates.push({
        x: Math.round(a.x + (b.x - a.x) * t),
        y: Math.round(a.y + (b.y - a.y) * t),
      });
    }
  }

  // First pass: completely clear of cards, other labels, AND other edges.
  for (const candidate of candidates) {
    const box = labelRect(candidate);
    if (nodeBoxes.some((node) => rectsOverlap(box, node))) continue;
    if (placedLabels.some((other) => rectsOverlap(box, other))) continue;
    if (
      allSegments.some(
        (seg) => seg.edgeId !== edgeId && segmentHitsRect(seg.a, seg.b, box),
      )
    )
      continue;
    placedLabels.push(box);
    return candidate;
  }

  // Second pass: clear of cards and other labels.
  for (const candidate of candidates) {
    const box = labelRect(candidate);
    if (nodeBoxes.some((node) => rectsOverlap(box, node))) continue;
    if (placedLabels.some((other) => rectsOverlap(box, other))) continue;
    placedLabels.push(box);
    return candidate;
  }

  placedLabels.push(labelRect(preferred));
  return preferred;
}

export function layoutArchitectureMap(
  fullMap: ArchitectureMap,
  options: ArchitectureLayoutOptions = {},
): {
  nodes: PartNode[];
  edges: Edge[];
  hiddenMinorCount: number;
} {
  const foundation = findFoundationParts(fullMap);
  const usedBy = new Map<string, Set<string>>();
  for (const { sourcePartId, targetPartId } of fullMap.connections) {
    if (!foundation.has(targetPartId)) continue;
    usedBy.set(
      targetPartId,
      (usedBy.get(targetPartId) ?? new Set()).add(sourcePartId),
    );
  }
  const { displays, hiddenMinorCount } = displayConnections(
    fullMap,
    foundation,
    options.showMinor ?? false,
  );
  // Route and lay out only the main parts; foundation parts sit in a strip below.
  const map = {
    parts: fullMap.parts.filter((part) => !foundation.has(part.id)),
    connections: displays.filter((display) => !display.foundation),
  };

  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: 136,
    ranksep: 256,
    edgesep: 64,
    marginx: 24,
    marginy: 24,
  });

  for (const part of map.parts) {
    graph.setNode(part.id, { ...partNodeSize });
  }
  // Minor connections still shape the layout so toggling them does not move cards.
  for (const connection of fullMap.connections) {
    if (
      foundation.has(connection.sourcePartId) ||
      foundation.has(connection.targetPartId)
    )
      continue;
    graph.setEdge(connection.sourcePartId, connection.targetPartId);
  }
  dagre.layout(graph);

  const positions = new Map<string, XYPosition>();
  let minTop = Number.POSITIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;
  for (const part of map.parts) {
    const placed = graph.node(part.id);
    const position = {
      x: Math.round(placed.x - partNodeSize.width / 2),
      y: Math.round(placed.y - partNodeSize.height / 2),
    };
    positions.set(part.id, position);
    minTop = Math.min(minTop, position.y);
    maxBottom = Math.max(maxBottom, position.y + partNodeSize.height);
  }
  if (!Number.isFinite(minTop)) minTop = 0;
  if (!Number.isFinite(maxBottom)) maxBottom = partNodeSize.height;

  const paddedNodeBoxes: Rect[] = map.parts.map((part) => {
    const pos = positions.get(part.id)!;
    return {
      id: part.id,
      left: pos.x - nodePadding,
      right: pos.x + partNodeSize.width + nodePadding,
      top: pos.y - nodePadding,
      bottom: pos.y + partNodeSize.height + nodePadding,
    };
  });

  const tightNodeBoxes: Rect[] = map.parts.map((part) => {
    const pos = positions.get(part.id)!;
    return {
      id: part.id,
      left: pos.x - 10,
      right: pos.x + partNodeSize.width + 10,
      top: pos.y - 10,
      bottom: pos.y + partNodeSize.height + 10,
    };
  });

  interface EdgePlan {
    connection: DisplayConnection;
    forward: boolean;
    sourceSide: Position;
    targetSide: Position;
    sourceOffset: number;
    targetOffset: number;
  }

  const plans: EdgePlan[] = map.connections.map((connection) => {
    const sourcePos = positions.get(connection.sourcePartId)!;
    const targetPos = positions.get(connection.targetPartId)!;
    const forward = targetPos.x >= sourcePos.x + partNodeSize.width + 24;
    return {
      connection,
      forward,
      sourceSide: forward ? Position.Right : Position.Bottom,
      targetSide: forward ? Position.Left : Position.Bottom,
      sourceOffset: 50,
      targetOffset: 50,
    };
  });

  // Fan out outgoing/incoming handles along each card edge to minimize crossings.
  const outgoingGroups = new Map<string, EdgePlan[]>();
  const incomingGroups = new Map<string, EdgePlan[]>();
  for (const plan of plans) {
    const outKey = `${plan.connection.sourcePartId}:${plan.sourceSide}`;
    const inKey = `${plan.connection.targetPartId}:${plan.targetSide}`;
    outgoingGroups.set(outKey, [...(outgoingGroups.get(outKey) ?? []), plan]);
    incomingGroups.set(inKey, [...(incomingGroups.get(inKey) ?? []), plan]);
  }

  for (const group of outgoingGroups.values()) {
    group.sort((a, b) => {
      const posA = positions.get(a.connection.targetPartId)!;
      const posB = positions.get(b.connection.targetPartId)!;
      return a.sourceSide === Position.Right
        ? posA.y - posB.y || posA.x - posB.x
        : posA.x - posB.x || posA.y - posB.y;
    });
    group.forEach((plan, index) => {
      plan.sourceOffset = distributedOffset(index, group.length);
    });
  }

  for (const group of incomingGroups.values()) {
    group.sort((a, b) => {
      const posA = positions.get(a.connection.sourcePartId)!;
      const posB = positions.get(b.connection.sourcePartId)!;
      return a.targetSide === Position.Left
        ? posA.y - posB.y || posA.x - posB.x
        : posA.x - posB.x || posA.y - posB.y;
    });
    group.forEach((plan, index) => {
      plan.targetOffset = distributedOffset(index, group.length);
    });
  }

  const handlesByPart = new Map<string, Map<string, NodeHandle>>();
  function registerHandle(
    partId: string,
    type: NodeHandle["type"],
    position: Position,
    offset: number,
  ): string {
    const id = `${type}-${position}-${offset}`;
    let mapForPart = handlesByPart.get(partId);
    if (!mapForPart) {
      mapForPart = new Map();
      handlesByPart.set(partId, mapForPart);
    }
    mapForPart.set(id, { id, type, position, offset });
    return id;
  }

  // Track vertical segments (with their y spans) so parallel vertical tracks stay cleanly separated.
  const usedVerticalTracks: { x: number; minY: number; maxY: number }[] = [];
  function allocateVerticalX(
    preferred: number,
    minX: number,
    maxX: number,
    y1: number,
    y2: number,
  ) {
    const clamp = (value: number) =>
      Math.round(Math.max(minX, Math.min(maxX, value)));
    const minY = Math.min(y1, y2) - 12;
    const maxY = Math.max(y1, y2) + 12;
    const base = clamp(preferred);
    const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6];
    for (const step of offsets) {
      const candidate = clamp(base + step * trackSpacing);
      const conflict = usedVerticalTracks.some(
        (track) =>
          Math.abs(track.x - candidate) < minVerticalSeparation &&
          track.maxY >= minY &&
          track.minY <= maxY,
      );
      if (!conflict) {
        usedVerticalTracks.push({ x: candidate, minY, maxY });
        return candidate;
      }
    }
    usedVerticalTracks.push({ x: base, minY, maxY });
    return base;
  }

  // Track horizontal segments (with their x spans) so parallel horizontal lines stay separated.
  const usedHorizontalTracks: { y: number; minX: number; maxX: number }[] = [];
  let topHighwayIndex = 0;
  let bottomHighwayIndex = 0;

  function recordHorizontalTrack(y: number, x1: number, x2: number) {
    if (Math.abs(x2 - x1) < 20) return;
    usedHorizontalTracks.push({
      y,
      minX: Math.min(x1, x2) - 12,
      maxX: Math.max(x1, x2) + 12,
    });
  }

  function horizontalTrackClear(y: number, x1: number, x2: number): boolean {
    const minX = Math.min(x1, x2) - 12;
    const maxX = Math.max(x1, x2) + 12;
    return usedHorizontalTracks.every(
      (track) =>
        Math.abs(track.y - y) >= minHorizontalSeparation ||
        track.maxX < minX ||
        track.minX > maxX,
    );
  }

  function pickClearCorridorY(
    exitX: number,
    entryX: number,
    dagrePoints: readonly XYPosition[],
    startY: number,
    endY: number,
    ignoreIds: ReadonlySet<string>,
  ): number {
    const candidates: number[] = [];

    if (dagrePoints.length > 2) {
      for (let i = 1; i < dagrePoints.length - 1; i++) {
        candidates.push(Math.round(dagrePoints[i]!.y));
      }
    }

    const intermediateY = map.parts
      .filter((part) => !ignoreIds.has(part.id))
      .map((part) => positions.get(part.id)!)
      .filter((pos) => pos.x + partNodeSize.width > exitX && pos.x < entryX)
      .sort((a, b) => a.y - b.y);

    for (let i = 0; i + 1 < intermediateY.length; i++) {
      const upperBottom = intermediateY[i]!.y + partNodeSize.height;
      const lowerTop = intermediateY[i + 1]!.y;
      const gap = lowerTop - upperBottom;
      if (gap >= 56) {
        const mid = Math.round((upperBottom + lowerTop) / 2);
        candidates.push(mid);
        if (gap >= 110) {
          candidates.push(mid - 28, mid + 28);
        }
      }
    }

    const preferredY = Math.round(startY * 0.65 + endY * 0.35);
    candidates.sort(
      (a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY),
    );

    for (const candidateY of candidates) {
      const probe: XYPosition[] = [
        { x: exitX, y: candidateY },
        { x: entryX, y: candidateY },
      ];
      if (pathHitsAnyBox(probe, paddedNodeBoxes, ignoreIds)) continue;
      if (!horizontalTrackClear(candidateY, exitX, entryX)) continue;
      recordHorizontalTrack(candidateY, exitX, entryX);
      return candidateY;
    }

    // Fall back to a clean dedicated top or bottom highway (whichever is closer).
    const topY = minTop - highwayOffset - highwaySpacing * topHighwayIndex;
    const bottomY =
      maxBottom + highwayOffset + highwaySpacing * bottomHighwayIndex;
    if (Math.abs(preferredY - topY) <= Math.abs(preferredY - bottomY)) {
      topHighwayIndex++;
      recordHorizontalTrack(topY, exitX, entryX);
      return topY;
    }
    bottomHighwayIndex++;
    recordHorizontalTrack(bottomY, exitX, entryX);
    return bottomY;
  }

  // Pass 1: compute all edge routes and collect every segment so labels can dodge other edges.
  interface RoutedEdge {
    plan: EdgePlan;
    start: XYPosition;
    end: XYPosition;
    bends: XYPosition[];
    preferredLabel: XYPosition;
    sourceHandle: string;
    targetHandle: string;
  }

  const routedEdges: RoutedEdge[] = [];
  const allSegments: Segment[] = [];

  for (const plan of plans) {
    const { connection, forward, sourceSide, targetSide } = plan;
    const sourcePos = positions.get(connection.sourcePartId)!;
    const targetPos = positions.get(connection.targetPartId)!;
    const start = anchorPoint(sourcePos, sourceSide, plan.sourceOffset);
    const end = anchorPoint(targetPos, targetSide, plan.targetOffset);
    const ignoreIds = new Set([
      connection.sourcePartId,
      connection.targetPartId,
    ]);

    const dagreEdge = graph.edge(
      connection.sourcePartId,
      connection.targetPartId,
    ) as { points?: XYPosition[] } | undefined;
    const dagrePoints = dagreEdge?.points ?? [];

    let bends: XYPosition[];
    let preferredLabel: XYPosition;

    if (forward) {
      const gapLeft = start.x + 36;
      const gapRight = end.x - 36;
      const straight = Math.abs(start.y - end.y) <= 4;
      const directPath: XYPosition[] = straight
        ? [start, end]
        : [
            start,
            { x: Math.round((start.x + end.x) / 2), y: start.y },
            { x: Math.round((start.x + end.x) / 2), y: end.y },
            end,
          ];

      const simpleClear =
        !pathHitsAnyBox(directPath, paddedNodeBoxes, ignoreIds) &&
        horizontalTrackClear(
          start.y,
          start.x,
          Math.round((start.x + end.x) / 2),
        );

      if (simpleClear && straight) {
        recordHorizontalTrack(start.y, start.x, end.x);
        bends = [];
        preferredLabel = {
          x: Math.round((start.x + end.x) / 2),
          y: start.y,
        };
      } else if (simpleClear) {
        const midX = allocateVerticalX(
          (start.x + end.x) / 2,
          gapLeft,
          gapRight,
          start.y,
          end.y,
        );
        const candidatePath: XYPosition[] = [
          start,
          { x: midX, y: start.y },
          { x: midX, y: end.y },
          end,
        ];
        if (!pathHitsAnyBox(candidatePath, paddedNodeBoxes, ignoreIds)) {
          recordHorizontalTrack(start.y, start.x, midX);
          recordHorizontalTrack(end.y, midX, end.x);
          bends = [
            { x: midX, y: start.y },
            { x: midX, y: end.y },
          ];
          preferredLabel =
            Math.abs(end.y - start.y) >= 88
              ? { x: midX, y: Math.round((start.y + end.y) / 2) }
              : { x: Math.round((start.x + midX) / 2), y: start.y };
        } else {
          const exitX = allocateVerticalX(
            start.x + 68,
            start.x + 36,
            Math.min(start.x + 190, end.x - 76),
            start.y,
            end.y,
          );
          const entryX = allocateVerticalX(
            end.x - 68,
            Math.max(exitX + 48, end.x - 190),
            end.x - 36,
            start.y,
            end.y,
          );
          const laneY = pickClearCorridorY(
            exitX,
            entryX,
            dagrePoints,
            start.y,
            end.y,
            ignoreIds,
          );
          bends = [
            { x: exitX, y: start.y },
            { x: exitX, y: laneY },
            { x: entryX, y: laneY },
            { x: entryX, y: end.y },
          ];
          preferredLabel = { x: Math.round((exitX + entryX) / 2), y: laneY };
        }
      } else {
        const exitX = allocateVerticalX(
          start.x + 68,
          start.x + 36,
          Math.min(start.x + 190, end.x - 76),
          start.y,
          end.y,
        );
        const entryX = allocateVerticalX(
          end.x - 68,
          Math.max(exitX + 48, end.x - 190),
          end.x - 36,
          start.y,
          end.y,
        );
        const laneY = pickClearCorridorY(
          exitX,
          entryX,
          dagrePoints,
          start.y,
          end.y,
          ignoreIds,
        );
        bends = [
          { x: exitX, y: start.y },
          { x: exitX, y: laneY },
          { x: entryX, y: laneY },
          { x: entryX, y: end.y },
        ];
        preferredLabel = { x: Math.round((exitX + entryX) / 2), y: laneY };
      }
    } else {
      const laneY =
        maxBottom + highwayOffset + highwaySpacing * bottomHighwayIndex++;
      recordHorizontalTrack(laneY, start.x, end.x);
      bends = [
        { x: start.x, y: laneY },
        { x: end.x, y: laneY },
      ];
      preferredLabel = { x: Math.round((start.x + end.x) / 2), y: laneY };
    }

    const sourceHandle = registerHandle(
      connection.sourcePartId,
      "source",
      sourceSide,
      plan.sourceOffset,
    );
    const targetHandle = registerHandle(
      connection.targetPartId,
      "target",
      targetSide,
      plan.targetOffset,
    );

    const routePoints = [start, ...bends, end];
    for (let i = 0; i + 1 < routePoints.length; i++) {
      allSegments.push({
        edgeId: connection.id,
        a: routePoints[i]!,
        b: routePoints[i + 1]!,
      });
    }

    routedEdges.push({
      plan,
      start,
      end,
      bends,
      preferredLabel,
      sourceHandle,
      targetHandle,
    });
  }

  const foundationParts = fullMap.parts.filter((part) =>
    foundation.has(part.id),
  );
  if (foundationParts.length > 0) {
    const mainPositions = [...positions.values()];
    const mainLeft = Math.min(...mainPositions.map((pos) => pos.x));
    const mainRight = Math.max(
      ...mainPositions.map((pos) => pos.x + partNodeSize.width),
    );
    const gap = 64;
    const stripWidth =
      foundationParts.length * partNodeSize.width +
      (foundationParts.length - 1) * gap;
    const stripLeft = Math.round((mainLeft + mainRight - stripWidth) / 2);
    const stripTop =
      maxBottom + highwayOffset + highwaySpacing * bottomHighwayIndex + 72;
    foundationParts.forEach((part, index) => {
      positions.set(part.id, {
        x: stripLeft + index * (partNodeSize.width + gap),
        y: stripTop,
      });
    });
  }

  function toEdge(
    connection: DisplayConnection,
    sourceHandle: string,
    targetHandle: string,
    route?: {
      source: XYPosition;
      target: XYPosition;
      bends: XYPosition[];
      label: XYPosition;
    },
  ): Edge {
    const color =
      connection.status === "new"
        ? "var(--success)"
        : connection.status === "changed"
          ? "var(--warning)"
          : "var(--muted-foreground)";
    const marker = {
      type: MarkerType.ArrowClosed,
      color,
      width: 18,
      height: 18,
    };
    const bidirectional = connection.connections.length > 1;
    const weight = connectionWeight(
      connection.connections.reduce((sum, entry) => sum + entry.count, 0),
    );
    return {
      id: connection.id,
      type: "behaviour",
      source: connection.sourcePartId,
      target: connection.targetPartId,
      sourceHandle,
      targetHandle,
      label: displayLabel(connection),
      className: [
        connection.status === "new"
          ? "arch-edge-new"
          : connection.status === "changed"
            ? "arch-edge-changed"
            : "",
        connection.uncommitted ? "arch-edge-uncommitted" : "",
      ]
        .filter(Boolean)
        .join(" "),
      markerEnd: marker,
      ...(bidirectional ? { markerStart: marker } : {}),
      style: { stroke: color, strokeWidth: weight },
      data: {
        ...(route ? { route } : {}),
        description: connection.connections
          .map(connectionDescription)
          .join("\n"),
        connectionId: connection.id,
        connectionIds: connection.connections.map((entry) => entry.id),
        changeStatus: connection.status,
        uncommitted: connection.uncommitted,
        weight,
        bidirectional,
        foundation: connection.foundation,
      },
    };
  }

  // Pass 2: place labels on clear segments away from cards, other labels, and other edges.
  const placedLabels: Rect[] = [];
  const edges: Edge[] = routedEdges.map((routed) => {
    const { connection } = routed.plan;
    const label = placeClearLabel(
      connection.id,
      [routed.start, ...routed.bends, routed.end],
      routed.preferredLabel,
      tightNodeBoxes,
      placedLabels,
      allSegments,
    );
    return toEdge(connection, routed.sourceHandle, routed.targetHandle, {
      source: routed.start,
      target: routed.end,
      bends: routed.bends,
      label,
    });
  });

  // Foundation lines are drawn only on focus, so a direct step path is enough.
  const foundationDisplays = displays.filter((display) => display.foundation);
  const incomingByFoundation = new Map<string, DisplayConnection[]>();
  for (const display of foundationDisplays) {
    const group = incomingByFoundation.get(display.targetPartId) ?? [];
    group.push(display);
    incomingByFoundation.set(display.targetPartId, group);
  }
  for (const group of incomingByFoundation.values()) {
    group.sort(
      (a, b) =>
        positions.get(a.sourcePartId)!.x - positions.get(b.sourcePartId)!.x,
    );
    group.forEach((display, index) => {
      edges.push(
        toEdge(
          display,
          registerHandle(display.sourcePartId, "source", Position.Bottom, 50),
          registerHandle(
            display.targetPartId,
            "target",
            Position.Top,
            distributedOffset(index, group.length),
          ),
        ),
      );
    });
  }

  const nodes: PartNode[] = fullMap.parts.map((part) => {
    const position = positions.get(part.id)!;
    const handles = handlesByPart.get(part.id);
    const users = usedBy.get(part.id)?.size;
    const classes = [
      "arch-part-node",
      `arch-part-kind-${part.kind}`,
      part.change.status === "new"
        ? "arch-part-new"
        : part.change.status === "changed"
          ? "arch-part-changed"
          : "",
      part.change.uncommitted ? "arch-part-uncommitted" : "",
      foundation.has(part.id) ? "arch-part-foundation" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return {
      id: part.id,
      type: "part",
      position,
      className: classes,
      style: partNodeSize,
      ariaLabel: `${part.name}, ${part.kind}, ${part.files.length} files${users ? `, used by ${users} parts` : ""}`,
      data: {
        label: part.name,
        name: part.name,
        purpose: part.purpose,
        kind: part.kind,
        fileCount: part.files.length,
        status: part.change.status,
        uncommitted: part.change.uncommitted,
        ...(users ? { usedBy: users } : {}),
        ...(part.fallback ? { fallback: true } : {}),
        ...(handles ? { handles: [...handles.values()] } : {}),
      },
    };
  });

  return { nodes, edges, hiddenMinorCount };
}
