import type { GraphNode, SearchResult, SourceRange } from "@mycel/shared";
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
export function isSourceRange(value: unknown): value is SourceRange {
  return (
    isRecord(value) &&
    ["start", "end", "startLine", "startColumn", "endLine", "endColumn"].every(
      (key) => typeof value[key] === "number",
    )
  );
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
    isSourceRange(value.range)
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
        ["CALLS", "CONTAINS", "IMPORTS"].includes(String(edge.kind)) &&
        (edge.sourceRanges === undefined ||
          (Array.isArray(edge.sourceRanges) &&
            edge.sourceRanges.every(
              (range) =>
                isRecord(range) &&
                typeof range.startLine === "number" &&
                typeof range.endLine === "number" &&
                Number.isSafeInteger(range.startLine) &&
                Number.isSafeInteger(range.endLine) &&
                range.startLine > 0 &&
                range.endLine >= range.startLine,
            ))),
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
    ["typescript", "tsx", "python"].includes(String(value.language))
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
    (value.relationship === undefined ||
      (value.entityType === "edge" &&
        (value.action === "created" || value.action === "deleted") &&
        isRecordedRelationship(value.relationship))) &&
    (value.fileSummary === undefined ||
      isFileChangeSummary(value.fileSummary)) &&
    (value.beforeRevision === null ||
      typeof value.beforeRevision === "number") &&
    (value.afterRevision === null || typeof value.afterRevision === "number")
  );
}

function isFileChangeSummary(value: unknown): boolean {
  const count = (item: unknown) =>
    typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  return (
    isRecord(value) &&
    Array.isArray(value.symbols) &&
    value.symbols.every(
      (symbol) =>
        isRecord(symbol) &&
        typeof symbol.name === "string" &&
        ["created", "modified", "deleted"].includes(String(symbol.action)),
    ) &&
    count(value.symbolCount) &&
    count(value.addedCalls) &&
    count(value.removedCalls) &&
    count(value.addedImports) &&
    count(value.removedImports)
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

export function isRepositoryGraph(
  value: unknown,
): value is import("@mycel/shared").RepositoryGraph {
  if (
    !isRecord(value) ||
    typeof value.projectId !== "string" ||
    typeof value.revision !== "number" ||
    !Array.isArray(value.files) ||
    !value.files.every((node) => isNode(node) && node.kind === "file") ||
    !Array.isArray(value.dependencies)
  )
    return false;
  const ids = new Set(value.files.map((node) => node.id));
  return value.dependencies.every(
    (edge) =>
      isRecord(edge) &&
      typeof edge.id === "string" &&
      edge.kind === "IMPORTS" &&
      ids.has(edge.sourceId) &&
      ids.has(edge.targetId),
  );
}

const architecturePartKinds = new Set([
  "app",
  "service",
  "library",
  "data",
  "integration",
  "cli",
]);
const architectureChangeWindows = new Set([
  "uncommitted",
  "branch",
  "7d",
  "30d",
]);
const architectureChangeStatuses = new Set(["new", "changed", "unchanged"]);

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isRecordedRelationship(value: unknown): boolean {
  const isEndpoint = (endpoint: unknown) =>
    isRecord(endpoint) &&
    typeof endpoint.id === "string" &&
    typeof endpoint.path === "string" &&
    typeof endpoint.qualifiedName === "string";
  return (
    isRecord(value) &&
    (value.kind === "IMPORTS" || value.kind === "CALLS") &&
    isEndpoint(value.source) &&
    isEndpoint(value.target) &&
    typeof value.startLine === "number" &&
    Number.isSafeInteger(value.startLine) &&
    value.startLine > 0 &&
    typeof value.endLine === "number" &&
    Number.isSafeInteger(value.endLine) &&
    value.endLine >= value.startLine &&
    (value.approximate === undefined ||
      typeof value.approximate === "boolean") &&
    Array.isArray(value.features) &&
    value.features.every(
      (feature) =>
        isRecord(feature) &&
        typeof feature.id === "string" &&
        typeof feature.name === "string",
    )
  );
}

function isSourceLineArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((line) => Number.isSafeInteger(line) && line > 0)
  );
}

export function isArchitectureUpdateEvent(
  value: unknown,
): value is import("@mycel/shared").ArchitectureUpdateEvent {
  return (
    isRecord(value) &&
    typeof value.projectId === "string" &&
    typeof value.revision === "number" &&
    ["file", "index", "git"].includes(String(value.reason)) &&
    typeof value.timestamp === "string"
  );
}

export function isArchitectureMap(
  value: unknown,
): value is import("@mycel/shared").ArchitectureMap {
  if (
    !isRecord(value) ||
    typeof value.projectId !== "string" ||
    typeof value.revision !== "number" ||
    !["agent", "folder-fallback"].includes(String(value.source)) ||
    (value.component !== undefined &&
      (!isRecord(value.component) ||
        typeof value.component.id !== "string" ||
        typeof value.component.name !== "string")) ||
    !Array.isArray(value.parts) ||
    !Array.isArray(value.connections) ||
    (value.relationshipChanges !== undefined &&
      (!Array.isArray(value.relationshipChanges) ||
        !value.relationshipChanges.every(
          (change) =>
            isRecord(change) &&
            typeof change.id === "string" &&
            /^\d+$/.test(change.id) &&
            typeof change.edgeId === "string" &&
            (change.action === "created" || change.action === "deleted") &&
            typeof change.sourcePartId === "string" &&
            typeof change.targetPartId === "string" &&
            typeof change.sourcePartName === "string" &&
            typeof change.targetPartName === "string" &&
            isRecordedRelationship(change.relationship),
        ))) ||
    !isRecord(value.changes) ||
    !isStringArray(value.unassignedFiles) ||
    !Array.isArray(value.tieWarnings)
  )
    return false;

  const changes = value.changes;
  if (
    typeof changes.available !== "boolean" ||
    !architectureChangeWindows.has(String(changes.requestedWindow)) ||
    !architectureChangeWindows.has(String(changes.resolvedWindow)) ||
    (changes.branch !== null && typeof changes.branch !== "string") ||
    (changes.baseRef !== null && typeof changes.baseRef !== "string") ||
    (changes.baseCommit !== null && typeof changes.baseCommit !== "string") ||
    !isStringArray(changes.addedFiles) ||
    !isStringArray(changes.modifiedFiles) ||
    !isStringArray(changes.deletedFiles) ||
    !isStringArray(changes.uncommittedFiles)
  )
    return false;

  const validParts = value.parts.every(
    (part) =>
      isRecord(part) &&
      typeof part.id === "string" &&
      typeof part.name === "string" &&
      typeof part.purpose === "string" &&
      architecturePartKinds.has(String(part.kind)) &&
      (part.boundary === undefined || typeof part.boundary === "boolean") &&
      (part.unassigned === undefined || typeof part.unassigned === "boolean") &&
      (part.subcomponents === undefined ||
        (Array.isArray(part.subcomponents) &&
          part.subcomponents.every(
            (child) =>
              isRecord(child) &&
              typeof child.id === "string" &&
              typeof child.name === "string" &&
              typeof child.purpose === "string" &&
              isStringArray(child.paths),
          ))) &&
      isStringArray(part.paths) &&
      isStringArray(part.files) &&
      isRecord(part.change) &&
      architectureChangeStatuses.has(String(part.change.status)) &&
      typeof part.change.uncommitted === "boolean" &&
      typeof part.change.addedFiles === "number" &&
      typeof part.change.modifiedFiles === "number" &&
      typeof part.change.uncommittedFiles === "number",
  );
  if (!validParts) return false;

  return value.connections.every(
    (connection) =>
      isRecord(connection) &&
      typeof connection.id === "string" &&
      typeof connection.sourcePartId === "string" &&
      typeof connection.targetPartId === "string" &&
      typeof connection.count === "number" &&
      typeof connection.importCount === "number" &&
      typeof connection.callCount === "number" &&
      typeof connection.truncated === "boolean" &&
      Array.isArray(connection.evidence) &&
      connection.evidence.every(
        (item) =>
          isRecord(item) &&
          ["import", "call"].includes(String(item.kind)) &&
          (item.edgeId === undefined || typeof item.edgeId === "string") &&
          typeof item.file === "string" &&
          typeof item.line === "number" &&
          (item.additionalLines === undefined ||
            isSourceLineArray(item.additionalLines)) &&
          (item.typeOnlyImportLines === undefined ||
            isSourceLineArray(item.typeOnlyImportLines)) &&
          (item.approximate === undefined ||
            typeof item.approximate === "boolean") &&
          typeof item.targetFile === "string",
      ) &&
      isRecord(connection.change) &&
      architectureChangeStatuses.has(String(connection.change.status)) &&
      (connection.change.relationshipChangeIds === undefined ||
        isStringArray(connection.change.relationshipChangeIds)) &&
      typeof connection.change.uncommitted === "boolean",
  );
}
