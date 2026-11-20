import type { Edge } from "@xyflow/react";
import type {
  ArchitectureConnectionWithChanges,
  ArchitectureMap,
  ArchitecturePartKind,
} from "@mycel/shared";
import {
  partNodeSize,
  placeArchitectureColumns,
  routeArchitectureLinks,
} from "./architecture-routing";
import type { PartNode } from "./part-node";

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
  revealConnectionIds?: readonly string[];
}

/** Keep named responsibilities on the canvas and show only relevant neighbors. */
export function componentCanvasMap(
  map: ArchitectureMap,
  focusId: string | undefined,
  showAll: boolean,
): ArchitectureMap {
  if (!map.component) return map;
  const unassigned = map.parts.find((part) => part.unassigned);
  const connections = map.connections.filter(
    ({ sourcePartId, targetPartId }) =>
      sourcePartId !== unassigned?.id &&
      targetPartId !== unassigned?.id &&
      (showAll || sourcePartId === focusId || targetPartId === focusId),
  );
  const connected = new Set(
    connections.flatMap(({ sourcePartId, targetPartId }) => [
      sourcePartId,
      targetPartId,
    ]),
  );
  return {
    ...map,
    connections,
    parts: map.parts.filter(
      (part) => !part.unassigned && (!part.boundary || connected.has(part.id)),
    ),
  };
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
  relationshipChanged: boolean;
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
 * shared contracts. They sit in the rightmost column and their lines appear on focus.
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
  { showMinor = false, revealConnectionIds }: ArchitectureLayoutOptions,
): { displays: DisplayConnection[]; hiddenMinorCount: number } {
  const revealed = new Set(revealConnectionIds);
  const minor = map.connections.filter(
    (connection) =>
      connection.count <= minorConnectionMaxCount &&
      !connection.change.relationshipChangeIds?.length,
  );
  const visible = map.connections.filter(
    (connection) =>
      showMinor ||
      connection.count > minorConnectionMaxCount ||
      Boolean(connection.change.relationshipChangeIds?.length) ||
      revealed.has(connection.id),
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
      relationshipChanged: pair.some(
        (entry) => entry.change.relationshipChangeIds?.length,
      ),
      foundation:
        foundation.has(primary.sourcePartId) ||
        foundation.has(primary.targetPartId),
    });
  }
  return {
    displays,
    hiddenMinorCount: showMinor ? 0 : minor.length,
  };
}

function connectionDescription(
  connection: ArchitectureConnectionWithChanges,
): string {
  const change =
    connection.change.status === "unchanged"
      ? ""
      : ` (${connection.change.status}${connection.change.uncommitted ? ", uncommitted" : ""})`;
  const recorded = connection.change.relationshipChangeIds?.length
    ? " · recent relationship change"
    : "";
  return `${connection.sourcePartId} → ${connection.targetPartId}: ${formatLinkSummary(connection)}${change}${recorded}`;
}

/** Keep roles in left-to-right columns, including when dependencies point back. */
export function layoutArchitectureMap(
  fullMap: ArchitectureMap,
  options: ArchitectureLayoutOptions = {},
): { nodes: PartNode[]; edges: Edge[]; hiddenMinorCount: number } {
  const foundation = fullMap.component
    ? new Set<string>()
    : findFoundationParts(fullMap);
  const { displays, hiddenMinorCount } = displayConnections(
    fullMap,
    foundation,
    fullMap.component ? { ...options, showMinor: true } : options,
  );
  const columns = roleLayers
    .map((kinds, index) =>
      fullMap.parts
        .filter(
          (part) =>
            !part.boundary &&
            (foundation.has(part.id)
              ? index === roleLayers.length - 1
              : kinds.includes(part.kind)),
        )
        .map((part) => part.id),
    )
    .filter((column) => column.length > 0);
  const boundary = fullMap.parts
    .filter((part) => part.boundary)
    .map((part) => part.id);
  if (boundary.length > 0) {
    const targets = new Set(
      fullMap.connections.map((edge) => edge.targetPartId),
    );
    const callers = boundary.filter((id) => !targets.has(id));
    const dependencies = boundary.filter((id) => targets.has(id));
    if (callers.length > 0) columns.unshift(callers);
    if (dependencies.length > 0) columns.push(dependencies);
  }
  const links = fullMap.connections.filter(
    (link) =>
      !foundation.has(link.targetPartId) &&
      link.count > minorConnectionMaxCount,
  );
  const positions = placeArchitectureColumns(
    columns,
    links.length ? links : fullMap.connections,
  );
  const routingOrder = [...displays].sort(
    (a, b) => Number(a.foundation) - Number(b.foundation),
  );
  const { handlesByPart, routes } = routeArchitectureLinks(
    columns,
    positions,
    routingOrder,
  );

  const usedBy = new Map<string, Set<string>>();
  for (const { sourcePartId, targetPartId } of fullMap.connections) {
    if (!foundation.has(targetPartId)) continue;
    const sources = usedBy.get(targetPartId) ?? new Set<string>();
    sources.add(sourcePartId);
    usedBy.set(targetPartId, sources);
  }

  const edges: Edge[] = routingOrder.map((connection, index) => {
    const { sourceHandle, targetHandle, curve } = routes[index]!;
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
        description: connection.connections
          .map(connectionDescription)
          .join("\n"),
        connectionId: connection.id,
        connectionIds: connection.connections.map((entry) => entry.id),
        changeStatus: connection.status,
        relationshipChanged: connection.relationshipChanged,
        uncommitted: connection.uncommitted,
        architecture: true,
        bidirectional: connection.connections.length > 1,
        foundation: connection.foundation,
      },
    };
  });

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
      ariaLabel: `${part.name}, ${part.boundary ? "external component, " : ""}${part.kind}, ${part.files.length} files${part.change.status !== "unchanged" ? `, ${part.change.status}` : ""}${part.change.uncommitted ? ", uncommitted changes" : ""}${users ? `, used by ${users} parts` : ""}`,
      data: {
        label: part.name,
        name: part.name,
        purpose: part.purpose,
        kind: part.kind,
        fileCount: part.files.length,
        status: part.change.status,
        uncommitted: part.change.uncommitted,
        ...(part.boundary ? { boundary: true } : {}),
        ...(users ? { usedBy: users } : {}),
        ...(part.fallback ? { fallback: true } : {}),
        ...(handles ? { handles } : {}),
      },
    };
  });

  return { nodes, edges, hiddenMinorCount };
}
