import dagre from "@dagrejs/dagre";
import { Position, type Edge } from "@xyflow/react";
import type {
  BehaviourHop,
  BehaviourPath,
  BehaviourTrace,
  SemanticEntity,
  SemanticRelationshipKind,
} from "@mycel/shared";
import { operationKindLabel, type CodeNode } from "@/features/graph/graph-node";
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

type BehaviourEdge = Edge<{ paths: BehaviourHop[][] }> & {
  data: { paths: BehaviourHop[][] };
};

function edgeLabel(paths: BehaviourHop[][]): string {
  const kinds = new Set(paths.map((path) => path.at(-1)!.relationship.kind));
  if (kinds.has("READS") && kinds.has("WRITES")) return "reads / writes";
  if (kinds.has("READS")) return "reads";
  if (kinds.has("WRITES")) return "writes";
  if (paths.length > 1) return `${paths.length} paths`;
  const path = paths[0]!;
  return path.length > 1
    ? `via ${path.length - 1} steps`
    : relationshipLabels[path[0]!.relationship.kind];
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
  for (const { id, kind, attributes } of entities.values()) {
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
    for (const hop of path.hops) {
      pending.push(hop);
      if (!anchors.has(hop.toId)) continue;
      const source = pending[0]!.fromId;
      if (pending.length > 1) expandable.add(source);
      if (pending.length > 1 && expanded.has(source)) {
        for (const step of pending) {
          visible.add(step.toId);
          connect([step]);
        }
      } else connect(pending);
      pending = [];
    }
  }

  const vertical = direction === "TB";
  const width = vertical ? 200 : 234;
  const height = 122;
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({
    rankdir: vertical ? "BT" : "RL",
    ranker: "longest-path",
    nodesep: vertical ? 38 : 68,
    ranksep: vertical ? 70 : 112,
  });
  for (const id of visible) layout.setNode(id, { width, height });
  // Dagre ranks the longest path from each sink. Reverse only the layout so
  // ranks follow the entry points and shorter sibling branches stay nearby.
  for (const { source, target } of links.values())
    layout.setEdge(target, source);
  dagre.layout(layout);

  const nodes: CodeNode[] = [...visible].map((id) => {
    const entity = entities.get(id)!;
    const { title, kind } = presentation.get(id)!;
    const point = layout.node(id);
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
      sourcePosition: vertical ? Position.Bottom : Position.Right,
      targetPosition: vertical ? Position.Top : Position.Left,
      position: { x: point.x - width / 2, y: point.y - height / 2 },
      style: { width, height },
    };
  });
  const edges: BehaviourEdge[] = Array.from(links, ([id, link]) => {
    const evidence = [...link.paths.values()];
    return {
      id,
      source: link.source,
      target: link.target,
      label: edgeLabel(evidence),
      data: { paths: evidence },
      style: evidence.some((path) => path.length > 1)
        ? { strokeDasharray: "5 4" }
        : {},
    };
  });
  return { entities, nodes, edges, notices, expandable };
}
