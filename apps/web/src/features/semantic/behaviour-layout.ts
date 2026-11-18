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
  showCalls: boolean,
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
  const visible = new Set(traces.map((trace) => trace.rootId));
  const notices = new Map<string, Set<string>>();
  for (const { id, kind, attributes } of entities.values()) {
    if (
      showCalls ||
      kind === "endpoint" ||
      kind === "data_model" ||
      attributes.traceRole === "unresolved"
    )
      visible.add(id);
  }
  for (const path of paths) {
    const terminal = path.entityIds.at(-1);
    if (!terminal) continue;
    visible.add(terminal);
    // Keep the full cycle visible so a condensed link cannot look like a self-call.
    if (path.end === "cycle") for (const id of path.entityIds) visible.add(id);
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
  // Condense within each returned path, then merge shared visual connections.
  // This keeps alternate paths' evidence separate and preserves traversal direction.
  for (const path of paths) {
    let pending: BehaviourHop[] = [];
    for (const hop of path.hops) {
      pending.push(hop);
      if (!visible.has(hop.toId)) continue;
      const source = pending[0]!.fromId;
      const target = hop.toId;
      const id = JSON.stringify([source, target]);
      const link = links.get(id) ?? { source, target, paths: new Map() };
      link.paths.set(
        JSON.stringify(pending.map(({ relationship }) => relationship.id)),
        pending,
      );
      links.set(id, link);
      pending = [];
    }
  }

  const vertical = direction === "TB";
  const width = vertical ? 200 : 234;
  const height = 114;
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({
    rankdir: direction,
    nodesep: vertical ? 38 : 68,
    ranksep: vertical ? 70 : 112,
  });
  for (const id of visible) layout.setNode(id, { width, height });
  for (const { source, target } of links.values())
    layout.setEdge(source, target);
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
  return { entities, nodes, edges, notices };
}
