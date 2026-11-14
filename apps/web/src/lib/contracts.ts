import type { GraphNode, SearchResult } from "@mycel/shared";
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
export function isNode(value: unknown): value is GraphNode {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    ["file", "function", "class", "method"].includes(String(value.kind)) &&
    typeof value.name === "string" &&
    typeof value.qualifiedName === "string" &&
    typeof value.path === "string" &&
    typeof value.contentHash === "string" &&
    typeof value.revision === "number" &&
    isRecord(value.range) &&
    ["start", "end", "startLine", "startColumn", "endLine", "endColumn"].every(
      (key) =>
        typeof value.range === "object" &&
        value.range !== null &&
        typeof (value.range as Record<string, unknown>)[key] === "number",
    )
  );
}
export function isSearchResult(value: unknown): value is SearchResult {
  return (
    isRecord(value) &&
    typeof value.projectId === "string" &&
    typeof value.revision === "number" &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isNode) &&
    typeof value.truncated === "boolean"
  );
}

export function isNeighborhood(
  value: unknown,
): value is import("@mycel/shared").Neighborhood {
  return (
    isSearchResult(value) &&
    isRecord(value) &&
    typeof value.rootId === "string" &&
    Array.isArray(value.edges) &&
    value.edges.every(
      (edge) =>
        isRecord(edge) &&
        typeof edge.id === "string" &&
        typeof edge.sourceId === "string" &&
        typeof edge.targetId === "string" &&
        ["CALLS", "CONTAINS", "IMPORTS"].includes(String(edge.kind)),
    )
  );
}

export function isNodeDetails(
  value: unknown,
): value is import("@mycel/shared").NodeDetails {
  if (
    !isRecord(value) ||
    !isNode(value.node) ||
    typeof value.revision !== "number" ||
    typeof value.projectId !== "string"
  )
    return false;
  return (
    [value.callers, value.dependencies, value.relatedFiles].every(
      (list) =>
        isRecord(list) &&
        Array.isArray(list.nodes) &&
        list.nodes.every(isNode) &&
        typeof list.truncated === "boolean",
    ) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(
      (item) => isRecord(item) && typeof item.message === "string",
    )
  );
}

export function isFileContent(
  value: unknown,
): value is import("@mycel/shared").FileContent {
  return (
    isRecord(value) &&
    typeof value.projectId === "string" &&
    typeof value.revision === "number" &&
    typeof value.path === "string" &&
    typeof value.content === "string" &&
    typeof value.contentHash === "string" &&
    ["typescript", "tsx"].includes(String(value.language))
  );
}

export function isChangeEvent(
  value: unknown,
): value is import("@mycel/shared").ChangeEvent {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !/^\d+$/.test(value.id) ||
    typeof value.projectId !== "string" ||
    typeof value.entityId !== "string" ||
    typeof value.path !== "string" ||
    typeof value.timestamp !== "string" ||
    !Number.isFinite(Date.parse(value.timestamp)) ||
    !["created", "modified", "deleted"].includes(String(value.action))
  )
    return false;
  const isEntity = (entity: unknown) =>
    value.entityType === "node"
      ? isNode(entity)
      : isRecord(entity) &&
        typeof entity.id === "string" &&
        typeof entity.sourceId === "string" &&
        typeof entity.targetId === "string" &&
        ["CALLS", "CONTAINS", "IMPORTS"].includes(String(entity.kind));
  return (
    ["node", "edge"].includes(String(value.entityType)) &&
    (value.before === null || isEntity(value.before)) &&
    (value.after === null || isEntity(value.after)) &&
    (value.beforeRevision === null ||
      typeof value.beforeRevision === "number") &&
    (value.afterRevision === null || typeof value.afterRevision === "number")
  );
}
export function isChangesPage(
  value: unknown,
): value is import("@mycel/shared").ChangesPage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isChangeEvent) &&
    (value.cursor === null || typeof value.cursor === "string")
  );
}
export function isChangeDiff(
  value: unknown,
): value is import("@mycel/shared").ChangeDiff {
  return (
    isRecord(value) &&
    typeof value.changeId === "string" &&
    typeof value.path === "string" &&
    (value.beforeContent === null || typeof value.beforeContent === "string") &&
    (value.afterContent === null || typeof value.afterContent === "string") &&
    (value.beforeRevision === null ||
      typeof value.beforeRevision === "number") &&
    (value.afterRevision === null || typeof value.afterRevision === "number")
  );
}

export function isGraphStats(
  value: unknown,
): value is import("@mycel/shared").GraphStats {
  return (
    isRecord(value) &&
    typeof value.projectId === "string" &&
    [
      "revision",
      "fileCount",
      "symbolCount",
      "edgeCount",
      "diagnosticCount",
    ].every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isSafeInteger(value[key]) &&
        value[key] >= 0,
    )
  );
}
