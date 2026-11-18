import type { BehaviourPath, SemanticEntity } from "@mycel/shared";
import type { OperationKind } from "@/features/graph/graph-node";

export const architectureLayers = [
  "interface",
  "api",
  "logic",
  "service",
  "data",
  "unresolved",
] as const;

export type ArchitectureLayer = (typeof architectureLayers)[number];

function ownLayer(
  entity: SemanticEntity,
  kind: OperationKind,
): ArchitectureLayer | undefined {
  switch (kind) {
    case "event":
      return "interface";
    case "endpoint":
      return "api";
    case "service":
      return "service";
    case "data":
    case "model":
      return "data";
    case "unresolved":
      return "unresolved";
  }
  if (entity.provenance.rule === "http-handler-operation") return "api";
}

/**
 * Plain functions and outbound requests have no architectural role of their
 * own, so they join the layer of the code that calls them.
 */
export function assignLayers(
  entities: Map<string, SemanticEntity>,
  paths: BehaviourPath[],
  presentation: Map<string, { kind: OperationKind }>,
) {
  const layers = new Map<string, ArchitectureLayer>();
  for (const [id, entity] of entities) {
    const layer = ownLayer(entity, presentation.get(id)!.kind);
    if (layer) layers.set(id, layer);
  }
  const callers = new Map<string, string[]>();
  for (const path of paths) {
    for (const { relationship } of path.hops) {
      if (relationship.kind !== "CALLS" && relationship.kind !== "HANDLES")
        continue;
      // A handler points at the endpoint it handles; requests flow the other way.
      const [caller, callee] =
        relationship.kind === "HANDLES"
          ? [relationship.targetId, relationship.sourceId]
          : [relationship.sourceId, relationship.targetId];
      const existing = callers.get(callee) ?? [];
      if (!existing.includes(caller)) existing.push(caller);
      callers.set(callee, existing);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [callee, ids] of callers) {
      if (layers.has(callee) || !entities.has(callee)) continue;
      const inherited = ids
        .map((id) => layers.get(id))
        .find((layer) => layer && layer !== "unresolved");
      if (inherited) {
        layers.set(callee, inherited);
        changed = true;
      }
    }
  }
  for (const id of entities.keys())
    if (!layers.has(id)) layers.set(id, "logic");
  return layers;
}

function directory(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

/** Describes where a layer's visible members live in the repository. */
export function layerLocation(paths: string[]) {
  const directories = [...new Set(paths.map(directory))].sort();
  if (directories.length === 0) return undefined;
  if (directories.length === 1) return directories[0] || "./";
  const [first, ...rest] = directories.map((path) => path.split("/"));
  const common: string[] = [];
  for (const [index, part] of first!.entries()) {
    if (!part || rest.some((parts) => parts[index] !== part)) break;
    common.push(part);
  }
  return common.length
    ? `${common.join("/")}/…`
    : directories.length === 2
      ? directories.map((path) => path || "./").join(", ")
      : `${directories.length} folders`;
}
