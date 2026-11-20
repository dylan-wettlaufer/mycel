import type { BehaviourHop } from "@mycel/shared";
import type { ArchitectureCurve } from "@/features/architecture/architecture-routing";
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
};

type RoutedEdge = Edge<
  {
    route?: Route;
    description?: string;
    architecture?: boolean;
    curve?: ArchitectureCurve;
  },
  "behaviour"
>;

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

function curveGeometry(props: EdgeProps<RoutedEdge>) {
  const source = { x: props.sourceX, y: props.sourceY };
  const target = { x: props.targetX, y: props.targetY };
  const curve = props.data?.curve;
  if (curve) {
    // Minor-link toggles and vertical drags may shift ports without changing
    // which columns the route passes through.
    if (
      Math.abs(source.x - curve.source.x) <= 8 &&
      Math.abs(target.x - curve.target.x) <= 8
    ) {
      const sameColumn = curve.source.x === curve.target.x;
      const points = sameColumn
        ? [
            source,
            { x: curve.waypoints[0]!.x, y: source.y },
            { x: curve.waypoints[1]!.x, y: target.y },
            target,
          ]
        : [source, ...curve.waypoints, target];
      let path = `M ${source.x},${source.y}`;
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1]!;
        const b = points[index]!;
        const middleX = (a.x + b.x) / 2;
        path += ` C ${middleX},${a.y} ${middleX},${b.y} ${b.x},${b.y}`;
      }
      const a = points[Math.floor(points.length / 2) - 1]!;
      const b = points[Math.floor(points.length / 2)]!;
      return [
        sameColumn ? roundedPath(points) : path,
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
      ] as const;
    }
  }
  return getBezierPath(props);
}

export function BehaviourEdgeView(props: EdgeProps<RoutedEdge>) {
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
  const [path, labelX, labelY] = data?.architecture
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
