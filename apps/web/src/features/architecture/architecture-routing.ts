import { Position, type XYPosition } from "@xyflow/react";
import type { NodeHandle } from "@/features/graph/graph-node";

export const partNodeSize = { width: 312, height: 116 };
const columnGap = 144;
const cardGap = 84;
const columnStep = partNodeSize.width + columnGap;
const cardStep = partNodeSize.height + cardGap;

interface Link {
  id: string;
  sourcePartId: string;
  targetPartId: string;
  foundation?: boolean;
}

export interface ArchitectureCurve {
  source: XYPosition;
  target: XYPosition;
  waypoints: XYPosition[];
}

interface TrackRequest {
  ideal: number;
  leftY: number;
  rightY: number;
  y: number;
}

interface ColumnContact {
  nearY: number;
  farY: number;
  side: "leftY" | "rightY";
}

interface LinkPlan {
  link: Link;
  source: XYPosition;
  target: XYPosition;
  sourceSide: Position;
  targetSide: Position;
  tracks: TrackRequest[];
  detour?: number;
}

/** Exchange neighbors when doing so shortens their links. Roles stay in their columns. */
export function placeArchitectureColumns(columns: string[][], links: Link[]) {
  const tallestColumn = Math.max(0, ...columns.map((column) => column.length));
  const positions = new Map<string, XYPosition>();
  const neighbors = new Map<string, Set<string>>();
  for (const { sourcePartId, targetPartId } of links) {
    for (const [id, peer] of [
      [sourcePartId, targetPartId],
      [targetPartId, sourcePartId],
    ] as const) {
      const adjacent = neighbors.get(id) ?? new Set();
      adjacent.add(peer);
      neighbors.set(id, adjacent);
    }
  }
  columns.forEach((column, layer) => {
    column.forEach((id, index) => {
      positions.set(id, {
        x: layer * columnStep,
        y: ((tallestColumn - column.length) / 2 + index) * cardStep,
      });
    });
  });

  function cost(
    id: string,
    y: number,
    x: number,
    swappingWith: string,
  ): number {
    let sum = 0;
    for (const peer of neighbors.get(id) ?? []) {
      if (peer === swappingWith) continue;
      const other = positions.get(peer)!;
      // Keep connections in the same or next column particularly short.
      const distance = Math.abs(y - other.y) / cardStep;
      sum += distance ** 2 / Math.max(1, Math.abs(x - other.x) / columnStep);
    }
    return sum;
  }

  for (const sweep of [columns, [...columns].reverse(), columns]) {
    for (const column of sweep) {
      for (let index = 1; index < column.length; index++) {
        const first = column[index - 1]!;
        const second = column[index]!;
        const a = positions.get(first)!;
        const b = positions.get(second)!;
        const before =
          cost(first, a.y, a.x, second) + cost(second, b.y, b.x, first);
        const after =
          cost(first, b.y, b.x, second) + cost(second, a.y, a.x, first);
        if (after >= before) continue;
        column[index - 1] = second;
        column[index] = first;
        positions.set(first, b);
        positions.set(second, a);
      }
    }
  }
  return positions;
}

/** Give links distinct tracks inside each clear interval through a column. */
function assignTracks(
  requests: TrackRequest[],
  cards: number[],
  contacts: ColumnContact[],
) {
  if (!requests.length) return;
  const top = cards[0]!;
  const bottom = cards.at(-1)! + partNodeSize.height;
  const gaps = [
    { min: top - 58, max: top - 16 },
    ...cards.slice(1).map((y) => ({ min: y - cardGap + 16, max: y - 16 })),
    { min: bottom + 16, max: bottom + 58 },
  ].map((bounds) => ({ ...bounds, requests: [] as TrackRequest[] }));

  contacts.sort((a, b) => a.nearY - b.nearY);
  for (const request of requests.sort((a, b) => a.ideal - b.ideal)) {
    // When a track moves below a contact, a crossing either disappears or
    // appears. Sweep the contacts once across all candidate gaps.
    let crossings = 0;
    for (const { side, farY } of contacts) {
      if (request[side] > farY) crossings++;
    }
    let contactIndex = 0;
    let gap = gaps[0]!;
    let lowest = Number.POSITIVE_INFINITY;
    for (const candidate of gaps) {
      const y = Math.max(candidate.min, Math.min(request.ideal, candidate.max));
      while (
        contactIndex < contacts.length &&
        contacts[contactIndex]!.nearY < y
      ) {
        const { side, farY } = contacts[contactIndex++]!;
        crossings += Math.sign(farY - request[side]);
      }
      const cost =
        Math.abs(request.ideal - y) +
        candidate.requests.length * 10 +
        crossings * cardStep;
      if (cost < lowest) {
        gap = candidate;
        lowest = cost;
      }
    }
    gap.requests.push(request);
  }
  for (const { min, max, requests } of gaps) {
    const spacing = Math.min(
      14,
      (max - min) / Math.max(1, requests.length - 1),
    );
    let next = min;
    requests.forEach((request, index) => {
      const limit = max - spacing * (requests.length - index - 1);
      request.y = Math.max(next, Math.min(request.ideal, limit));
      next = request.y + spacing;
    });
  }
}

function anchor(position: XYPosition, handle: NodeHandle): XYPosition {
  const offset = handle.offset! / 100;
  switch (handle.position) {
    case Position.Left:
      return { x: position.x, y: position.y + partNodeSize.height * offset };
    case Position.Right:
      return {
        x: position.x + partNodeSize.width,
        y: position.y + partNodeSize.height * offset,
      };
    case Position.Top:
      return { x: position.x + partNodeSize.width * offset, y: position.y };
    case Position.Bottom:
      return {
        x: position.x + partNodeSize.width * offset,
        y: position.y + partNodeSize.height,
      };
  }
}

function distributedOffset(index: number, count: number) {
  if (count <= 1) return 50;
  const span = Math.min(76, 24 * (count - 1));
  return (100 - span) / 2 + (span * index) / (count - 1);
}

export function routeArchitectureLinks(
  columns: string[][],
  positions: ReadonlyMap<string, XYPosition>,
  links: Link[],
) {
  const plans: LinkPlan[] = [];
  const requests = columns.map((): TrackRequest[] => []);
  const contacts = columns.map((): ColumnContact[] => []);
  const sideTracks = columns.map(
    (): { from: number; to: number; side: Position; lane: number }[] => [],
  );
  for (const link of links) {
    const source = positions.get(link.sourcePartId)!;
    const target = positions.get(link.targetPartId)!;
    const sourceColumn = source.x / columnStep;
    const targetColumn = target.x / columnStep;
    const direction = Math.sign(targetColumn - sourceColumn);
    const tracks: TrackRequest[] = [];
    let sourceSide: Position;
    let targetSide: Position;
    let detour: number | undefined;
    if (direction !== 0) {
      sourceSide = direction > 0 ? Position.Right : Position.Left;
      targetSide = direction > 0 ? Position.Left : Position.Right;
      const rise = (target.y - source.y) / (targetColumn - sourceColumn);
      const sourceY = source.y + partNodeSize.height / 2;
      const targetY = target.y + partNodeSize.height / 2;
      if (!link.foundation && Math.abs(sourceColumn - targetColumn) === 1) {
        contacts[sourceColumn]!.push({
          nearY: sourceY,
          farY: targetY,
          side: direction > 0 ? "rightY" : "leftY",
        });
        contacts[targetColumn]!.push({
          nearY: targetY,
          farY: sourceY,
          side: direction > 0 ? "leftY" : "rightY",
        });
      }
      for (
        let column = sourceColumn + direction;
        column !== targetColumn;
        column += direction
      ) {
        const ideal = sourceY + rise * (column - sourceColumn);
        const request = {
          ideal,
          leftY: ideal - rise,
          rightY: ideal + rise,
          y: ideal,
        };
        requests[column]!.push(request);
        tracks.push(request);
      }
    } else if (Math.abs(source.y - target.y) <= cardStep) {
      sourceSide = source.y < target.y ? Position.Bottom : Position.Top;
      targetSide = source.y < target.y ? Position.Top : Position.Bottom;
    } else {
      const from = Math.min(source.y, target.y);
      const to = Math.max(source.y, target.y);
      const lanes = sideTracks[sourceColumn]!;
      const overlapping = lanes.filter(
        (track) => track.from <= to && track.to >= from,
      );
      const right = overlapping.filter(
        (track) => track.side === Position.Right,
      ).length;
      const left = overlapping.length - right;
      const side = right <= left ? Position.Right : Position.Left;
      const taken = new Set(
        overlapping
          .filter((track) => track.side === side)
          .map((track) => track.lane),
      );
      let lane = 0;
      while (taken.has(lane)) lane++;
      lanes.push({ from, to, side, lane });
      const clearance = 24 + (32 * lane) / (lane + 3);
      sourceSide = targetSide = side;
      detour =
        side === Position.Right
          ? source.x + partNodeSize.width + clearance
          : source.x - clearance;
    }
    plans.push({
      link,
      source,
      target,
      sourceSide,
      targetSide,
      tracks,
      ...(detour === undefined ? {} : { detour }),
    });
  }

  requests.forEach((tracks, index) =>
    assignTracks(
      tracks,
      columns[index]!.map((id) => positions.get(id)!.y),
      contacts[index]!,
    ),
  );

  const groups = new Map<
    string,
    { partId: string; handle: NodeHandle; order: number }[]
  >();
  function register(partId: string, handle: NodeHandle, order: number) {
    const key = `${partId}:${handle.position}`;
    const group = groups.get(key) ?? [];
    group.push({ partId, handle, order });
    groups.set(key, group);
    return handle;
  }
  const ports = plans.map((plan) => {
    const { link, source, target, sourceSide, targetSide, tracks, detour } =
      plan;
    const vertical =
      sourceSide === Position.Top || sourceSide === Position.Bottom;
    // Sort ports by the next track to keep links from crossing as they leave a card.
    const sourceOrder = vertical
      ? target.x
      : (tracks[0]?.y ?? target.y + partNodeSize.height / 2);
    const targetOrder = vertical
      ? source.x
      : (tracks.at(-1)?.y ?? source.y + partNodeSize.height / 2);
    const sourceHandle = register(
      link.sourcePartId,
      { id: `${link.id}:source`, type: "source", position: sourceSide },
      sourceOrder,
    );
    const targetHandle = register(
      link.targetPartId,
      { id: `${link.id}:target`, type: "target", position: targetSide },
      targetOrder,
    );
    return { source, target, sourceHandle, targetHandle, tracks, detour };
  });

  const handlesByPart = new Map<string, NodeHandle[]>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.order - b.order);
    group.forEach(({ partId, handle }, index) => {
      handle.offset = distributedOffset(index, group.length);
      const handles = handlesByPart.get(partId) ?? [];
      handles.push(handle);
      handlesByPart.set(partId, handles);
    });
  }
  const routes = ports.map(
    ({ source, target, sourceHandle, targetHandle, tracks, detour }) => {
      const start = anchor(source, sourceHandle);
      const end = anchor(target, targetHandle);
      const direction = Math.sign(target.x - source.x);
      const waypoints = tracks.flatMap(({ y }, index) => {
        const x = source.x + direction * (index + 1) * columnStep;
        const left = { x: x - 10, y };
        const right = { x: x + partNodeSize.width + 10, y };
        return direction > 0 ? [left, right] : [right, left];
      });
      if (detour !== undefined) {
        waypoints.push({ x: detour, y: start.y }, { x: detour, y: end.y });
      }
      const curve: ArchitectureCurve | undefined = waypoints.length
        ? { source: start, target: end, waypoints }
        : undefined;
      return {
        sourceHandle: sourceHandle.id,
        targetHandle: targetHandle.id,
        curve,
      };
    },
  );
  return { handlesByPart, routes };
}
