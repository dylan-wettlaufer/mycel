import dagre, {
  type EdgeLabel,
  type GraphLabel,
  type NodeLabel,
} from "@dagrejs/dagre";
import { Position, type XYPosition } from "@xyflow/react";
import type {
  BehaviourHop,
  BehaviourPath,
  BehaviourTrace,
  SemanticEntity,
  SemanticRelationshipKind,
} from "@mycel/shared";
import { operationKindLabel, type CodeNode } from "@/features/graph/graph-node";
import type { BehaviourEdge } from "@/features/graph/behaviour-edge";
import { describeBehaviour } from "./behaviour-presentation";

export const relationshipLabels: Record<SemanticRelationshipKind, string> = {
  CALLS: "calls",
  HANDLES: "handled by",
  READS: "reads",
  WRITES: "writes",
  RENDERS: "renders",
  IMPLEMENTS: "implements",
  DEPENDS_ON: "depends on",
};

const terminalLabels: Record<BehaviourPath["end"], string> = {
  "data-access": "",
  unresolved: "Mycel could not resolve this step.",
  "no-supported-calls": "No further supported calls.",
  "no-supported-callers": "No further supported callers.",
  "depth-limit": "Reached the trace depth limit.",
  cycle: "This path returns to a previous step.",
  "work-limit": "Reached the trace work limit.",
};

function edgeLabel(paths: BehaviourHop[][]): string {
  const kinds = new Set(paths.map((path) => path.at(-1)!.relationship.kind));
  if (kinds.has("READS") && kinds.has("WRITES")) return "reads / writes";
  if (kinds.has("READS")) return "reads";
  if (kinds.has("WRITES")) return "writes";
  if (paths.length > 1) return `${paths.length} paths`;
  const path = paths[0]!;
  return path.length > 1
    ? `via ${path.length - 1} ${path.length === 2 ? "step" : "steps"}`
    : relationshipLabels[path[0]!.relationship.kind];
}

type Link = {
  id: string;
  source: string;
  target: string;
  paths: BehaviourHop[][];
  label: string;
  uncertain: boolean;
};

const nodeHeight = 102;

function placeNodes(ids: Set<string>, links: Link[], vertical: boolean) {
  const width = vertical ? 196 : 216;
  const layout = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>();
  layout.setGraph({
    rankdir: vertical ? "BT" : "RL",
    ranker: "longest-path",
    nodesep: vertical ? 48 : 62,
    ranksep: vertical ? 54 : 56,
    edgesep: 24,
  });
  for (const id of ids) layout.setNode(id, { width, height: nodeHeight });
  // Rank from entry points and use Dagre's reserved label space and bend points.
  for (const { source, target, label } of links) {
    layout.setEdge(target, source, {
      labelpos: "c",
      width: label.length * 7 + 14,
      height: 22,
    });
  }
  dagre.layout(layout);
  return { layout, width };
}

function anchor(
  point: XYPosition,
  position: Position,
  width: number,
): XYPosition {
  switch (position) {
    case Position.Top:
      return { x: point.x, y: point.y - nodeHeight / 2 };
    case Position.Bottom:
      return { x: point.x, y: point.y + nodeHeight / 2 };
    case Position.Left:
      return { x: point.x - width / 2, y: point.y };
    case Position.Right:
      return { x: point.x + width / 2, y: point.y };
  }
}

export function layoutBehaviour(
  traces: BehaviourTrace[],
  expanded: ReadonlySet<string> = new Set(),
  direction: "LR" | "TB" = "LR",
  members: SemanticEntity[] = [],
) {
  const entities = new Map(
    traces.flatMap((trace) =>
      trace.entities.map((entity) => [entity.id, entity] as const),
    ),
  );
  const paths = traces.flatMap((trace) => trace.paths);
  const presentation = describeBehaviour(entities, paths, members);
  const anchors = new Set(traces.map((trace) => trace.rootId));
  const notices = new Map<string, Set<string>>();
  const unresolved = new Set<string>();
  for (const { id, kind, attributes } of entities.values()) {
    if (attributes.traceRole === "unresolved") unresolved.add(id);
    if (
      kind === "endpoint" ||
      kind === "data_model" ||
      attributes.traceRole === "unresolved"
    )
      anchors.add(id);
  }
  for (const path of paths) {
    const terminal = path.entityIds.at(-1);
    if (!terminal) continue;
    anchors.add(terminal);
    if (path.end === "unresolved") unresolved.add(terminal);
    // Keep the full cycle visible so a condensed link cannot look like a self-call.
    if (path.end === "cycle") for (const id of path.entityIds) anchors.add(id);
    const notice = path.boundary?.message ?? terminalLabels[path.end];
    if (notice) {
      const existing = notices.get(terminal) ?? new Set<string>();
      existing.add(notice);
      notices.set(terminal, existing);
    }
  }

  const links = new Map<
    string,
    {
      source: string;
      target: string;
      paths: Map<string, BehaviourHop[]>;
    }
  >();
  const visible = new Set(anchors);
  const expandable = new Set<string>();
  const expandedPaths: BehaviourHop[][] = [];
  let maxVisibleHops = 0;

  function connect(path: BehaviourHop[]) {
    const source = path[0]!.fromId;
    const target = path.at(-1)!.toId;
    const id = JSON.stringify([source, target]);
    const link = links.get(id) ?? { source, target, paths: new Map() };
    link.paths.set(
      JSON.stringify(path.map(({ relationship }) => relationship.id)),
      path,
    );
    links.set(id, link);
  }

  // Split at the original anchors before revealing intermediate nodes so an
  // operation shared by two regions cannot unfold its other region by itself.
  for (const path of paths) {
    let pending: BehaviourHop[] = [];
    let visibleHops = 0;
    for (const hop of path.hops) {
      pending.push(hop);
      if (!anchors.has(hop.toId)) continue;
      const source = pending[0]!.fromId;
      if (pending.length > 1) expandable.add(source);
      if (pending.length > 1 && expanded.has(source)) {
        visibleHops += pending.length;
        expandedPaths.push(pending);
        for (const step of pending) {
          visible.add(step.toId);
          connect([step]);
        }
      } else {
        visibleHops++;
        connect(pending);
      }
      pending = [];
    }
    maxVisibleHops = Math.max(maxVisibleHops, visibleHops);
  }

  const diagramLinks = Array.from(links, ([id, { source, target, paths }]) => {
    const evidence = [...paths.values()];
    const uncertain =
      unresolved.has(target) ||
      evidence.some((path) =>
        path.some(
          ({ relationship }) =>
            relationship.provenance.kind !== "deterministic" ||
            relationship.provenance.rule === "unresolved-boundary",
        ),
      );
    const label = unresolved.has(target) ? "unresolved" : edgeLabel(evidence);
    return { id, source, target, paths: evidence, label, uncertain };
  });
  const vertical = direction === "TB" || maxVisibleHops >= 4;
  const { layout, width } = placeNodes(visible, diagramLinks, vertical);
  const sourcePosition = vertical ? Position.Bottom : Position.Right;
  const targetPosition = vertical ? Position.Top : Position.Left;
  function center(id: string) {
    const { x, y } = layout.node(id);
    return { x: x!, y: y! };
  }

  const nodes: CodeNode[] = [...visible].map((id) => {
    const entity = entities.get(id)!;
    const { title, kind } = presentation.get(id)!;
    const point = center(id);
    return {
      id,
      type: "code",
      ariaLabel: `${title}, ${entity.name}, ${operationKindLabel(kind)}`,
      data: {
        label: title,
        name: entity.name,
        operationKind: kind,
      },
      className: `graph-node graph-operation-node graph-operation-${kind}`,
      sourcePosition,
      targetPosition,
      position: { x: point.x - width / 2, y: point.y - nodeHeight / 2 },
      style: { width, height: nodeHeight },
    };
  });
  const edges: BehaviourEdge[] = diagramLinks.map(
    ({ id, source, target, paths, label, uncertain }) => {
      const routed = layout.edge(target, source);
      return {
        id,
        source,
        target,
        type: "behaviour",
        label,
        ariaLabel: `${entities.get(source)?.name} to ${entities.get(target)?.name}: ${label}`,
        ...(uncertain && { className: "graph-edge-uncertain" }),
        data: {
          paths,
          route: {
            source: anchor(center(source), sourcePosition, width),
            target: anchor(center(target), targetPosition, width),
            bends: routed.points!.slice(1, -1).reverse(),
            label: { x: routed.x!, y: routed.y! },
          },
        },
        style: uncertain
          ? { strokeDasharray: "2 5", strokeLinecap: "round" }
          : paths.some((path) => path.length > 1)
            ? { strokeDasharray: "7 4" }
            : {},
      };
    },
  );
  return {
    entities,
    presentation,
    nodes,
    edges,
    notices,
    expandable,
    expandedPaths,
  };
}
