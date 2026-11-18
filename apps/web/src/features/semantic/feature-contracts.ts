import type {
  BehaviourPath,
  BehaviourTrace,
  FeatureBehaviour,
  GraphQueryContext,
  SemanticEntity,
  SemanticFeatureList,
  SemanticProvenance,
  SemanticRelationship,
  SemanticSource,
} from "@mycel/shared";
import { isRecord, isSourceRange } from "@/lib/contracts";

function hasRevision(
  value: unknown,
): value is GraphQueryContext & Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.projectId === "string" &&
    typeof value.revision === "number"
  );
}

function isSource(value: unknown): value is SemanticSource {
  return (
    isRecord(value) &&
    typeof value.nodeId === "string" &&
    typeof value.path === "string" &&
    isSourceRange(value.range)
  );
}

function isProvenance(value: unknown): value is SemanticProvenance {
  return (
    isRecord(value) &&
    ["deterministic", "heuristic", "ai"].includes(String(value.kind)) &&
    typeof value.extractor === "string" &&
    typeof value.version === "string" &&
    typeof value.rule === "string" &&
    typeof value.confidence === "number"
  );
}

function isSemanticRecord(value: unknown) {
  return (
    hasRevision(value) &&
    typeof value.id === "string" &&
    isProvenance(value.provenance) &&
    Array.isArray(value.sources) &&
    value.sources.every(isSource)
  );
}

function isEntity(value: unknown): value is SemanticEntity {
  return (
    isRecord(value) &&
    isSemanticRecord(value) &&
    [
      "feature",
      "route",
      "page",
      "component",
      "endpoint",
      "service_operation",
      "data_model",
      "external_dependency",
    ].includes(String(value.kind)) &&
    typeof value.name === "string" &&
    isRecord(value.attributes) &&
    Object.values(value.attributes).every(
      (attribute) => typeof attribute === "string",
    )
  );
}

function isRelationship(value: unknown): value is SemanticRelationship {
  return (
    isRecord(value) &&
    isSemanticRecord(value) &&
    typeof value.sourceId === "string" &&
    typeof value.targetId === "string" &&
    [
      "RENDERS",
      "HANDLES",
      "CALLS",
      "READS",
      "WRITES",
      "IMPLEMENTS",
      "DEPENDS_ON",
    ].includes(String(value.kind))
  );
}

function isPath(value: unknown): value is BehaviourPath {
  return (
    isRecord(value) &&
    Array.isArray(value.entityIds) &&
    value.entityIds.every((id) => typeof id === "string") &&
    Array.isArray(value.hops) &&
    value.hops.every(
      (hop) =>
        isRecord(hop) &&
        typeof hop.fromId === "string" &&
        typeof hop.toId === "string" &&
        isRelationship(hop.relationship),
    ) &&
    [
      "data-access",
      "unresolved",
      "no-supported-calls",
      "no-supported-callers",
      "depth-limit",
      "cycle",
      "work-limit",
    ].includes(String(value.end)) &&
    (value.boundary === undefined ||
      (isRecord(value.boundary) &&
        typeof value.boundary.code === "string" &&
        typeof value.boundary.message === "string"))
  );
}

function isTrace(value: unknown): value is BehaviourTrace {
  if (
    !hasRevision(value) ||
    typeof value.rootId !== "string" ||
    value.direction !== "forward" ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.entities) ||
    !value.entities.every(isEntity) ||
    !Array.isArray(value.paths) ||
    !value.paths.every(isPath)
  )
    return false;
  const ids = new Set(value.entities.map(({ id }) => id));
  return (
    ids.has(value.rootId) &&
    value.paths.every(
      ({ entityIds, hops }) =>
        entityIds.every((id) => ids.has(id)) &&
        hops.every(({ fromId, toId }) => ids.has(fromId) && ids.has(toId)),
    )
  );
}

export function isFeatureList(value: unknown): value is SemanticFeatureList {
  return (
    hasRevision(value) &&
    typeof value.truncated === "boolean" &&
    Array.isArray(value.features) &&
    value.features.every(
      (entity) => isEntity(entity) && entity.kind === "feature",
    )
  );
}

export function isFeatureBehaviour(value: unknown): value is FeatureBehaviour {
  return (
    hasRevision(value) &&
    typeof value.featureId === "string" &&
    typeof value.truncated === "boolean" &&
    Array.isArray(value.entities) &&
    value.entities.every(isEntity) &&
    value.entities.some(
      (entity) => entity.id === value.featureId && entity.kind === "feature",
    ) &&
    Array.isArray(value.relationships) &&
    value.relationships.every(isRelationship) &&
    Array.isArray(value.traces) &&
    value.traces.every(
      (trace) =>
        isTrace(trace) &&
        trace.revision === value.revision &&
        trace.projectId === value.projectId,
    )
  );
}
