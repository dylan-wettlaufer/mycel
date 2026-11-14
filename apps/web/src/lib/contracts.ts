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
