import type { BehaviourHop } from "@mycel/shared";
import {
  BaseEdge,
  Position,
  getBezierPath,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type XYPosition,
} from "@xyflow/react";

type Route = {
  source: XYPosition;
  target: XYPosition;
  bends: XYPosition[];
  label: XYPosition;
};

type EdgeData = {
  paths: BehaviourHop[][];
  route: Route;
  description?: string;
  curved?: boolean;
  curve?: { source: XYPosition; target: XYPosition; waypoints: XYPosition[] };
};

export type BehaviourEdge = Edge<EdgeData, "behaviour"> & { data: EdgeData };

function toward(from: XYPosition, to: XYPosition, distance: number) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const fraction = length ? Math.min(distance / length, 0.5) : 0;
  return `${from.x + (to.x - from.x) * fraction},${from.y + (to.y - from.y) * fraction}`;
}

function roundedPath(points: XYPosition[]) {
  const [start] = points;
  let path = `M ${start!.x},${start!.y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const bend = points[index]!;
    path += ` L ${toward(bend, points[index - 1]!, 12)} Q ${bend.x},${bend.y} ${toward(bend, points[index + 1]!, 12)}`;
  }
  const end = points.at(-1)!;
  return `${path} L ${end.x},${end.y}`;
}

function lead(point: XYPosition, position: Position) {
  return {
    x:
      point.x +
      (position === Position.Right ? 12 : position === Position.Left ? -12 : 0),
    y:
      point.y +
      (position === Position.Bottom ? 12 : position === Position.Top ? -12 : 0),
  };
}

function curveGeometry(props: EdgeProps<BehaviourEdge>) {
  const source = { x: props.sourceX, y: props.sourceY };
  const target = { x: props.targetX, y: props.targetY };
  const curve = props.data?.curve;
  if (curve) {
    const dx = source.x - curve.source.x;
    const dy = source.y - curve.source.y;
    if (
      Math.abs(target.x - curve.target.x - dx) <= 8 &&
      Math.abs(target.y - curve.target.y - dy) <= 8
    ) {
      const points = [
        source,
        ...curve.waypoints.map(({ x, y }) => ({ x: x + dx, y: y + dy })),
        target,
      ];
      let path = `M ${source.x},${source.y}`;
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1]!;
        const b = points[index]!;
        const middleY = (a.y + b.y) / 2;
        path += ` C ${a.x},${middleY} ${b.x},${middleY} ${b.x},${b.y}`;
      }
      const a = points[Math.floor(points.length / 2) - 1]!;
      const b = points[Math.floor(points.length / 2)]!;
      return [path, (a.x + b.x) / 2, (a.y + b.y) / 2] as const;
    }
  }
  if (
    props.sourcePosition === Position.Top &&
    props.targetPosition === Position.Top &&
    Math.abs(source.y - target.y) < 8
  ) {
    const height = Math.min(86, Math.abs(source.x - target.x) / 3);
    return [
      `M ${source.x},${source.y} C ${source.x},${source.y - height} ${target.x},${target.y - height} ${target.x},${target.y}`,
      (source.x + target.x) / 2,
      (source.y + target.y) / 2 - height * 0.75,
    ] as const;
  }
  return getBezierPath(props);
}

export function BehaviourEdgeView(props: EdgeProps<BehaviourEdge>) {
  const {
    data,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  } = props;
  const route = data?.route;
  const [path, labelX, labelY] = data?.curved
    ? curveGeometry(props)
    : getSmoothStepPath({ ...props, borderRadius: 12 });
  let geometry = { path, labelX, labelY };
  if (route) {
    const shift = {
      x: [sourceX - route.source.x, targetX - route.target.x],
      y: [sourceY - route.source.y, targetY - route.target.y],
    };
    // Handles sit slightly outside the card, so compare the average translation.
    const dx = (shift.x[0]! + shift.x[1]!) / 2;
    const dy = (shift.y[0]! + shift.y[1]!) / 2;
    // Relayout can translate the whole graph. A manually dragged node needs a fresh route.
    if (
      Math.abs(shift.x[0]! - shift.x[1]!) <= 8 &&
      Math.abs(shift.y[0]! - shift.y[1]!) <= 8
    ) {
      const source = { x: sourceX, y: sourceY };
      const target = { x: targetX, y: targetY };
      geometry = {
        path: roundedPath([
          source,
          lead(source, sourcePosition),
          ...route.bends.map(({ x, y }) => ({ x: x + dx, y: y + dy })),
          lead(target, targetPosition),
          target,
        ]),
        labelX: route.label.x + dx,
        labelY: route.label.y + dy,
      };
    }
  }
  return (
    <g>
      {data?.description && <title>{data.description}</title>}
      <BaseEdge
        id={props.id}
        style={props.style}
        {...(props.markerStart && { markerStart: props.markerStart })}
        {...(props.markerEnd && { markerEnd: props.markerEnd })}
        label={props.label}
        labelStyle={props.labelStyle ?? {}}
        labelBgStyle={props.labelBgStyle ?? {}}
        labelBgPadding={props.labelBgPadding ?? [7, 4]}
        labelBgBorderRadius={props.labelBgBorderRadius ?? 4}
        {...geometry}
      />
    </g>
  );
}
