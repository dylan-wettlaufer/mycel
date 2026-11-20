import { Position, type Edge, type XYPosition } from "@xyflow/react";
import type {
  ArchitectureConnectionWithChanges,
  ArchitectureMap,
  ArchitecturePartKind,
} from "@mycel/shared";
import type { NodeHandle } from "@/features/graph/graph-node";
import type { PartNode } from "./part-node";

export const partNodeSize = { width: 312, height: 116 };

const columnGap = 48;
const layerGap = 104;
const roleLayers: ArchitecturePartKind[][] = [
  ["app", "cli"],
  ["service", "integration"],
  ["library"],
  ["data"],
];

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

export function formatLinkSummary(
  connection: ArchitectureConnectionWithChanges,
) {
  const pieces: string[] = [];
  if (connection.importCount > 0) {
    pieces.push(
      `${connection.importCount} ${connection.importCount === 1 ? "import" : "imports"}`,
    );
  }
  if (connection.callCount > 0) {
    pieces.push(
      `${connection.callCount} ${connection.callCount === 1 ? "call" : "calls"}`,
    );
  }
  return pieces.join(" · ") || `${connection.count} links`;
}

function displayLabel(display: DisplayConnection): string {
  const [forward, backward] = display.connections;
  return backward
    ? `${formatLinkSummary(forward!)} → · ${formatLinkSummary(backward)} ←`
    : formatLinkSummary(forward!);
}

/**
 * Parts that most other parts use and that depend on no other part, such as
 * shared contracts. They sit in the bottom row and their lines appear on focus.
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
          (part.kind === "library" || part.kind === "data") &&
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
  const change =
    connection.change.status === "unchanged"
      ? ""
      : ` (${connection.change.status}${connection.change.uncommitted ? ", uncommitted" : ""})`;
  return `${connection.sourcePartId} → ${connection.targetPartId}: ${formatLinkSummary(connection)}${change}`;
}

function distributedOffset(index: number, total: number): number {
  if (total <= 1) return 50;
  const span = Math.min(76, 24 * (total - 1));
  const start = 50 - span / 2;
  return Math.round(start + (span * index) / (total - 1));
}

/** Keep role rows fixed even when a dependency points up the map. */
export function layoutArchitectureMap(
  fullMap: ArchitectureMap,
  options: ArchitectureLayoutOptions = {},
): { nodes: PartNode[]; edges: Edge[]; hiddenMinorCount: number } {
  const foundation = findFoundationParts(fullMap);
  const { displays, hiddenMinorCount } = displayConnections(
    fullMap,
    foundation,
    options.showMinor ?? false,
  );
  const rows = roleLayers
    .map((kinds, index) =>
      fullMap.parts.filter((part) =>
        foundation.has(part.id)
          ? index === roleLayers.length - 1
          : kinds.includes(part.kind),
      ),
    )
    .filter((row) => row.length > 0);
  const positions = new Map<string, XYPosition>();
  const widestRow = Math.max(0, ...rows.map((row) => row.length));
  const columnStep = partNodeSize.width + columnGap;
  const rowStep = partNodeSize.height + layerGap;
  rows.forEach((row, rowIndex) => {
    row.forEach((part, column) => {
      positions.set(part.id, {
        x: ((widestRow - row.length) / 2 + column) * columnStep,
        y: rowIndex * rowStep,
      });
    });
  });

  const usedBy = new Map<string, Set<string>>();
  for (const { sourcePartId, targetPartId } of fullMap.connections) {
    if (!foundation.has(targetPartId)) continue;
    const sources = usedBy.get(targetPartId) ?? new Set<string>();
    sources.add(sourcePartId);
    usedBy.set(targetPartId, sources);
  }

  const plans = displays.map((connection) => {
    const source = positions.get(connection.sourcePartId)!;
    const target = positions.get(connection.targetPartId)!;
    const sameRow = target.y === source.y;
    const adjacent = sameRow && Math.abs(target.x - source.x) === columnStep;
    const downward = target.y > source.y;
    return {
      connection,
      source,
      target,
      sourceSide: adjacent
        ? target.x > source.x
          ? Position.Right
          : Position.Left
        : downward
          ? Position.Bottom
          : Position.Top,
      targetSide: adjacent
        ? target.x > source.x
          ? Position.Left
          : Position.Right
        : downward || sameRow
          ? Position.Top
          : Position.Bottom,
    };
  });

  const handlesByPart = new Map<string, NodeHandle[]>();
  const groups = new Map<string, { id: string; opposite: XYPosition }[]>();
  for (const { connection, source, target, sourceSide, targetSide } of plans) {
    for (const [partId, type, position, opposite] of [
      [connection.sourcePartId, "source", sourceSide, target],
      [connection.targetPartId, "target", targetSide, source],
    ] as const) {
      const group = groups.get(`${partId}:${position}`) ?? [];
      group.push({ id: `${connection.id}:${type}`, opposite });
      groups.set(`${partId}:${position}`, group);
    }
  }
  const offsets = new Map<string, number>();
  for (const group of groups.values()) {
    group.sort(
      (a, b) => a.opposite.x - b.opposite.x || a.opposite.y - b.opposite.y,
    );
    group.forEach(({ id }, index) =>
      offsets.set(id, distributedOffset(index, group.length)),
    );
  }

  function registerHandle(
    partId: string,
    type: NodeHandle["type"],
    position: Position,
    edgeId: string,
  ) {
    const id = `${edgeId}:${type}`;
    const offset = offsets.get(id)!;
    const handles = handlesByPart.get(partId) ?? [];
    handles.push({ id, type, position, offset });
    handlesByPart.set(partId, handles);
    return id;
  }

  function toEdge(
    connection: DisplayConnection,
    sourceHandle: string,
    targetHandle: string,
    curve?: { source: XYPosition; target: XYPosition; waypoints: XYPosition[] },
  ): Edge {
    return {
      id: connection.id,
      type: "behaviour",
      source: connection.sourcePartId,
      target: connection.targetPartId,
      sourceHandle,
      targetHandle,
      label: displayLabel(connection),
      data: {
        ...(curve ? { curve } : {}),
        curved: true,
        description: connection.connections
          .map(connectionDescription)
          .join("\n"),
        connectionId: connection.id,
        connectionIds: connection.connections.map((entry) => entry.id),
        changeStatus: connection.status,
        uncommitted: connection.uncommitted,
        architecture: true,
        bidirectional: connection.connections.length > 1,
        foundation: connection.foundation,
      },
    };
  }

  const edges = plans.map(
    ({ connection, source, target, sourceSide, targetSide }) => {
      const sourceHandle = registerHandle(
        connection.sourcePartId,
        "source",
        sourceSide,
        connection.id,
      );
      const targetHandle = registerHandle(
        connection.targetPartId,
        "target",
        targetSide,
        connection.id,
      );
      const sourceX =
        source.x + (partNodeSize.width * offsets.get(sourceHandle)!) / 100;
      const targetX =
        target.x + (partNodeSize.width * offsets.get(targetHandle)!) / 100;
      const direction = Math.sign(target.y - source.y);
      const waypoints: XYPosition[] = [];

      // A skip link only detours when an intermediate row blocks its path.
      for (
        let y = source.y + direction * rowStep;
        direction * (target.y - y) > 0;
        y += direction * rowStep
      ) {
        const row = rows[y / rowStep]!;
        const firstX = positions.get(row[0]!.id)!.x;
        const lastX = positions.get(row.at(-1)!.id)!.x + partNodeSize.width;
        const idealX =
          sourceX +
          ((targetX - sourceX) * (y - source.y)) / (target.y - source.y);
        const gaps = Array.from(
          { length: row.length + 1 },
          (_, index) => firstX - columnGap / 2 + index * columnStep,
        );
        const x =
          idealX < firstX - 12 || idealX > lastX + 12
            ? idealX
            : gaps.reduce((best, gap) =>
                Math.abs(gap - idealX) < Math.abs(best - idealX) ? gap : best,
              );
        const top = y - 8;
        const bottom = y + partNodeSize.height + 8;
        waypoints.push(
          { x, y: direction > 0 ? top : bottom },
          { x, y: direction > 0 ? bottom : top },
        );
      }
      const curve = waypoints.length
        ? {
            source: {
              x: sourceX,
              y: source.y + (direction > 0 ? partNodeSize.height : 0),
            },
            target: {
              x: targetX,
              y: target.y + (direction > 0 ? 0 : partNodeSize.height),
            },
            waypoints,
          }
        : undefined;
      return toEdge(connection, sourceHandle, targetHandle, curve);
    },
  );

  const nodes: PartNode[] = fullMap.parts.map((part) => {
    const position = positions.get(part.id)!;
    const handles = handlesByPart.get(part.id);
    const users = usedBy.get(part.id)?.size;
    const classes = [
      "arch-part-node",
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
      ariaLabel: `${part.name}, ${part.kind}, ${part.files.length} files${part.change.status !== "unchanged" ? `, ${part.change.status}` : ""}${part.change.uncommitted ? ", uncommitted changes" : ""}${users ? `, used by ${users} parts` : ""}`,
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
        ...(handles ? { handles } : {}),
      },
    };
  });

  return { nodes, edges, hiddenMinorCount };
}
