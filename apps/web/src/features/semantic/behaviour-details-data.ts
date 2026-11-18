import type { BehaviourHop, SemanticEntity } from "@mycel/shared";
import { isRecord, isSourceRange } from "@/lib/contracts";
import { relationshipLabels, type layoutBehaviour } from "./behaviour-layout";

export type BehaviourLayout = ReturnType<typeof layoutBehaviour>;

export type BehaviourConnection = {
  id: string;
  labels: Set<string>;
  revealFrom?: string;
};

function schemaLocation(value: string | undefined) {
  if (!value) return;
  try {
    const location: unknown = JSON.parse(value);
    if (
      isRecord(location) &&
      typeof location.path === "string" &&
      isSourceRange(location.range)
    )
      return { path: location.path, range: location.range };
  } catch {
    // Older snapshots may lack a usable schema location.
  }
}

export function getBehaviourDetails(
  graph: BehaviourLayout,
  id: string,
  members: SemanticEntity[],
) {
  const entity = graph.entities.get(id);
  if (!entity) return;
  const visibleIds = new Set(graph.nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    ({ source, target }) => source === id || target === id,
  );
  const incoming = new Map<string, BehaviourConnection>();
  const outgoing = new Map<string, BehaviourConnection>();
  const data = new Map<string, BehaviourConnection>();

  function connect(
    path: BehaviourHop[],
    entersSelection: boolean,
    region: string,
  ) {
    const first = path[0]!;
    const last = path.at(-1)!;
    const relatedId = entersSelection ? first.fromId : last.toId;
    const kind = last.relationship.kind;
    const isData = kind === "READS" || kind === "WRITES";
    const group = isData ? data : entersSelection ? incoming : outgoing;
    const connection = group.get(relatedId) ?? {
      id: relatedId,
      labels: new Set<string>(),
    };
    if (!visibleIds.has(relatedId)) connection.revealFrom = region;
    let label = relationshipLabels[kind];
    if (isData && entersSelection)
      label =
        kind === "READS" ? "reads from this model" : "writes to this model";
    else if (!isData && path.length > 1) label = "connects";
    else if (kind === "HANDLES" && entersSelection) label = "handles";
    else if (last.relationship.provenance.rule === "literal-http-endpoint")
      label = "sends request";
    const via =
      path.length > 1
        ? ` via ${path.length - 1} ${path.length === 2 ? "step" : "steps"}`
        : "";
    const inferred = path.some(
      ({ relationship }) => relationship.provenance.kind === "heuristic",
    )
      ? " (inferred)"
      : "";
    connection.labels.add(
      `${label.charAt(0).toUpperCase()}${label.slice(1)}${via}${inferred}`,
    );
    group.set(relatedId, connection);
  }

  for (const edge of edges) {
    const entersSelection = edge.target === id && edge.source !== id;
    for (const path of edge.data.paths) {
      connect(path, entersSelection, edge.source);
      if (path.length > 1) {
        const step = entersSelection ? path.at(-1)! : path[0]!;
        // The origin of the compact edge controls the region in either direction.
        connect([step], entersSelection, edge.source);
      }
    }
  }
  // Keep feature-level links in the overview when the canvas shows their steps.
  for (const path of graph.expandedPaths) {
    const source = path[0]!.fromId;
    if (source === id) connect(path, false, source);
    else if (path.at(-1)!.toId === id) connect(path, true, source);
  }

  const owners = new Map<string, string>();
  for (const candidate of graph.entities.values()) {
    if (candidate.attributes.callableNodeId)
      owners.set(candidate.attributes.callableNodeId, candidate.name);
    if (candidate.provenance.rule === "http-handler-operation")
      for (const source of candidate.sources)
        owners.set(source.nodeId, candidate.name);
  }
  for (const member of members) {
    if (member.kind !== "component" && member.kind !== "page") continue;
    for (const source of member.sources)
      if (!owners.has(source.nodeId)) owners.set(source.nodeId, member.name);
  }

  return {
    entity,
    groups: [
      {
        title: "Called from / triggered by",
        connections: [...incoming.values()],
      },
      { title: "Calls / connects to", connections: [...outgoing.values()] },
      ...(data.size
        ? [{ title: "Reads or writes", connections: [...data.values()] }]
        : []),
    ],
    edges,
    sources: entity.sources.map((source) => ({
      ...source,
      owner: owners.get(source.nodeId),
    })),
    schema: schemaLocation(entity.attributes.schemaLocation),
  };
}
