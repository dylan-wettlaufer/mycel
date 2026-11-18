import { Position, type XYPosition } from "@xyflow/react";
import type { NodeHandle } from "@/features/graph/graph-node";
import {
  architectureLayers,
  type ArchitectureLayer,
} from "./behaviour-architecture";

export const operationSize = { width: 272, height: 112 };
const padding = 16;
const header = 64;
const columnGap = 104;
const rowGap = 64;
const stackGap = 48;
const bandGap = 112;
const laneOffset = 32;
const laneSpacing = 12;
const gapOffsets = [0, 12, -12, 24, -24];

type Link = { id: string; source: string; target: string };

export type PlacedLink = {
  sourceHandle: string;
  targetHandle: string;
  route: {
    source: XYPosition;
    target: XYPosition;
    bends: XYPosition[];
    label: XYPosition;
  };
};

export type PlacedLayer = {
  layer: ArchitectureLayer;
  members: string[];
  position: XYPosition;
  width: number;
  height: number;
};

function handleId(type: NodeHandle["type"], position: Position) {
  return `${type}-${position}`;
}

/**
 * Places each layer in its own column (or band when vertical) and routes links
 * through the gaps between layers so they never cross an operation card.
 */
export function placeArchitecture(
  ids: string[],
  layerOf: (id: string) => ArchitectureLayer,
  links: Link[],
  vertical: boolean,
) {
  const present = architectureLayers.filter((layer) =>
    ids.some((id) => layerOf(id) === layer),
  );
  const columnIndex = new Map(present.map((layer, index) => [layer, index]));
  const column = (id: string) => columnIndex.get(layerOf(id))!;
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const { source, target } of links) {
    outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
    incoming.set(target, [...(incoming.get(target) ?? []), source]);
  }

  // Depth-first order keeps a revealed call chain together inside its layer.
  const order: string[] = [];
  const seen = new Set<string>();
  function visit(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const target of outgoing.get(id) ?? []) visit(target);
  }
  for (const id of ids) if (!incoming.get(id)?.length) visit(id);
  for (const id of ids) visit(id);

  const slot = new Map<string, number>();
  const occupied = new Set<string>();
  const cell = (layer: number, index: number) => `${layer}:${index}`;
  const clear = (from: number, to: number, index: number) => {
    for (let layer = from + 1; layer < to; layer++)
      if (occupied.has(cell(layer, index))) return false;
    return true;
  };
  for (const [index] of present.entries()) {
    const pending = order.filter((member) => column(member) === index);
    while (pending.length) {
      // Place same-layer callers first; a cycle falls back to depth-first order.
      const ready = pending.findIndex(
        (id) =>
          !(incoming.get(id) ?? []).some(
            (source) => source !== id && pending.includes(source),
          ),
      );
      const [id] = pending.splice(Math.max(ready, 0), 1) as [string];
      const candidates = (incoming.get(id) ?? []).flatMap((source) => {
        const sourceSlot = slot.get(source);
        const from = column(source);
        if (sourceSlot === undefined || from > index) return [];
        const desired = from === index ? sourceSlot + 1 : sourceSlot;
        let next = desired;
        while (occupied.has(cell(index, next)) || !clear(from, index, next))
          next++;
        return [{ from, slot: next }];
      });
      // Stacking under a same-layer caller avoids a detour around the column.
      const stacked = candidates.filter(({ from }) => from === index);
      const options = stacked.length ? stacked : candidates;
      let placed = Math.min(...options.map((option) => option.slot));
      if (!options.length) {
        placed = 0;
        while (occupied.has(cell(index, placed))) placed++;
      }
      slot.set(id, placed);
      occupied.add(cell(index, placed));
    }
  }

  const { width, height } = operationSize;
  const slots = Math.max(0, ...slot.values()) + 1;
  // u runs across layers and v runs along a layer.
  const layerLength = vertical
    ? header + height + padding
    : width + padding * 2;
  const layerBreadth = vertical
    ? padding * 2 + slots * (width + bandGap) - bandGap
    : header + slots * (height + stackGap) - stackGap + padding;
  const layerGap = vertical ? rowGap : columnGap;
  const layerStart = (index: number) => index * (layerLength + layerGap);
  const gap = (index: number) => layerStart(index) + layerLength + layerGap / 2;
  const point = (u: number, v: number) =>
    vertical ? { x: v, y: u } : { x: u, y: v };
  const positions = new Map(
    [...slot].map(([id, index]) => {
      const start = layerStart(column(id));
      return [
        id,
        vertical
          ? { x: padding + index * (width + bandGap), y: start + header }
          : { x: start + padding, y: header + index * (height + stackGap) },
      ] as const;
    }),
  );
  function side(id: string, position: Position): XYPosition {
    const { x, y } = positions.get(id)!;
    switch (position) {
      case Position.Top:
        return { x: x + width / 2, y };
      case Position.Bottom:
        return { x: x + width / 2, y: y + height };
      case Position.Left:
        return { x, y: y + height / 2 };
      case Position.Right:
        return { x: x + width, y: y + height / 2 };
    }
  }
  const across = (value: XYPosition) => (vertical ? value.y : value.x);
  const along = (value: XYPosition) => (vertical ? value.x : value.y);
  const forwardOut = vertical ? Position.Bottom : Position.Right;
  const forwardIn = vertical ? Position.Top : Position.Left;
  const chainOut = vertical ? Position.Right : Position.Bottom;
  const chainIn = vertical ? Position.Left : Position.Top;

  const gapUses = new Map<number, number>();
  const inGap = (index: number) => {
    const uses = gapUses.get(index) ?? 0;
    gapUses.set(index, uses + 1);
    return gap(index) + gapOffsets[uses % gapOffsets.length]!;
  };
  let lanes = 0;
  const handles = new Map<string, Map<string, NodeHandle>>();
  function addHandle(id: string, type: NodeHandle["type"], position: Position) {
    const handle = { id: handleId(type, position), type, position };
    const existing = handles.get(id) ?? new Map<string, NodeHandle>();
    existing.set(handle.id, handle);
    handles.set(id, existing);
    return handle.id;
  }

  const placedLinks = new Map<string, PlacedLink>();
  for (const { id, source, target } of links) {
    const [from, to] = [column(source), column(target)];
    const [fromSlot, toSlot] = [slot.get(source)!, slot.get(target)!];
    const chain = from === to && toSlot === fromSlot + 1;
    const out = chain ? chainOut : forwardOut;
    const into = chain ? chainIn : from === to ? forwardOut : forwardIn;
    const start = side(source, out);
    const end = side(target, into);
    const fanIn = (incoming.get(target)?.length ?? 0) > 1;
    const fanOut = (outgoing.get(source)?.length ?? 0) > 1;
    const nearSource = (u: number) =>
      point((across(start) + u) / 2, along(start));
    const nearTarget = (u: number) => point((u + across(end)) / 2, along(end));
    let bends: XYPosition[] = [];
    let label: XYPosition;
    if (chain) {
      label = point(across(start), (along(start) + along(end)) / 2);
    } else if (from === to) {
      const u = inGap(from);
      bends = [point(u, along(start)), point(u, along(end))];
      label = point(u, (along(start) + along(end)) / 2);
    } else if (from < to && fromSlot === toSlot && clear(from, to, fromSlot)) {
      label =
        to === from + 1
          ? point(gap(from), along(start))
          : fanIn && !fanOut
            ? nearSource(gap(from))
            : nearTarget(gap(to - 1));
    } else if (from < to && clear(from, to, toSlot)) {
      const u = inGap(from);
      bends = [point(u, along(start)), point(u, along(end))];
      label =
        fanIn && !fanOut
          ? nearSource(u)
          : nearTarget(to === from + 1 ? u : gap(to - 1));
    } else if (from < to && clear(from, to, fromSlot)) {
      const u = inGap(to - 1);
      bends = [point(u, along(start)), point(u, along(end))];
      label =
        fanIn && !fanOut
          ? nearSource(to === from + 1 ? u : gap(from))
          : nearTarget(u);
    } else {
      // Backward links and blocked rows travel along a lane past every layer.
      const lane = layerBreadth + laneOffset + laneSpacing * lanes++;
      const [first, last] = [inGap(from), inGap(to - 1)];
      bends = [
        point(first, along(start)),
        point(first, lane),
        point(last, lane),
        point(last, along(end)),
      ];
      label = nearTarget(last);
    }
    placedLinks.set(id, {
      sourceHandle: addHandle(source, "source", out),
      targetHandle: addHandle(target, "target", into),
      route: { source: start, target: end, bends, label },
    });
  }

  const layers: PlacedLayer[] = present.map((layer, index) => ({
    layer,
    members: order.filter((id) => column(id) === index),
    position: point(layerStart(index), 0),
    width: vertical ? layerBreadth : layerLength,
    height: vertical ? layerLength : layerBreadth,
  }));
  return {
    positions,
    links: placedLinks,
    layers,
    handles: new Map(
      [...handles].map(([id, byId]): [string, NodeHandle[]] => [
        id,
        [...byId.values()],
      ]),
    ),
  };
}
