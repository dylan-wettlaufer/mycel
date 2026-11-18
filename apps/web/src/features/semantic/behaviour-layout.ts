import type {
  BehaviourHop,
  BehaviourPath,
  BehaviourTrace,
  SemanticEntity,
  SemanticRelationshipKind,
} from "@mycel/shared";
import { operationKindLabel, type CodeNode } from "@/features/graph/graph-node";
import type { LayerNode } from "@/features/graph/layer-node";
import type { BehaviourEdge } from "@/features/graph/behaviour-edge";
import { describeBehaviour } from "./behaviour-presentation";
import { assignLayers, layerLocation } from "./behaviour-architecture";
import { operationSize, placeArchitecture } from "./architecture-layout";

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
  const hiddenSteps = new Map<string, Set<string>>();

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
      if (pending.length > 1) {
        expandable.add(source);
        const steps = hiddenSteps.get(source) ?? new Set<string>();
        for (const step of pending.slice(0, -1)) steps.add(step.toId);
        hiddenSteps.set(source, steps);
      }
      if (pending.length > 1 && expanded.has(source)) {
        expandedPaths.push(pending);
        for (const step of pending) {
          visible.add(step.toId);
          connect([step]);
        }
      } else {
        connect(pending);
      }
      pending = [];
    }
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
  const layerOf = assignLayers(entities, paths, presentation);
  const placement = placeArchitecture(
    [...visible],
    (id) => layerOf.get(id)!,
    diagramLinks,
    direction === "TB",
  );

  const nodes: CodeNode[] = [...visible].map((id) => {
    const entity = entities.get(id)!;
    const { title, kind } = presentation.get(id)!;
    const [source] = entity.sources;
    return {
      id,
      type: "code",
      ariaLabel: `${title}, ${entity.name}, ${operationKindLabel(kind)}`,
      data: {
        label: title,
        name: entity.name,
        operationKind: kind,
        handles: placement.handles.get(id) ?? [],
        ...(source && {
          location: `${source.path.split("/").at(-1)}:${source.range.startLine}`,
        }),
      },
      className: `graph-node graph-operation-node graph-operation-${kind}`,
      position: placement.positions.get(id)!,
      style: { ...operationSize },
      // Positions encode the source-derived layer and keep routed links clear of cards.
      draggable: false,
    };
  });
  const layers: LayerNode[] = placement.layers.map(
    ({ layer, members, position, width, height }) => ({
      id: `layer:${layer}`,
      type: "layer",
      data: {
        layer,
        count: members.length,
        location: layerLocation(
          members.flatMap((id) =>
            entities
              .get(id)!
              .sources.slice(0, 1)
              .map(({ path }) => path),
          ),
        ),
        ...(direction === "TB" && { inset: operationSize.width / 2 + 32 }),
      },
      position,
      style: { width, height },
      className: `graph-layer-node graph-layer-${layer}`,
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    }),
  );
  const edges: BehaviourEdge[] = diagramLinks.map(
    ({ id, source, target, paths, label, uncertain }) => {
      const { sourceHandle, targetHandle, route } = placement.links.get(id)!;
      const steps = label.startsWith("via ");
      return {
        id,
        source,
        target,
        sourceHandle,
        targetHandle,
        type: "behaviour",
        label: steps ? label.slice("via ".length) : label,
        ariaLabel: `${entities.get(source)?.name} to ${entities.get(target)?.name}: ${label}`,
        ...(uncertain && { className: "graph-edge-uncertain" }),
        data: {
          paths,
          route,
          description: `${presentation.get(source)!.title} → ${presentation.get(target)!.title}: ${steps ? `connects ${label}` : label}`,
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
    layerOf,
    nodes,
    layers,
    edges,
    notices,
    expandable,
    steps: new Map(
      Array.from(hiddenSteps, ([id, steps]) => [id, steps.size] as const),
    ),
    expandedPaths,
  };
}
