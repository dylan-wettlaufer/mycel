import { getCrossFileLinks } from "@mycel/db";
import type { CrossFileLink, ProjectGraph, SqliteDatabase } from "@mycel/db";
import type {
  ArchitectureAssignment,
  ArchitectureConnection,
  ArchitectureConnectionEvidence,
  GraphEdge,
  GraphNode,
  ProjectId,
  ProjectInfo,
} from "@mycel/shared";
import { buildStructuralGraph } from "./graph.js";
import { captureRepository } from "./indexer.js";

export interface ComputeConnectionsOptions {
  /** Optional cap on stored evidence items per connection; counts stay exact. */
  evidenceLimit?: number;
}

export interface ArchitectureConnectionsSnapshot {
  projectId: ProjectId;
  revision: number;
  connections: ArchitectureConnection[];
}

export interface GraphLinkSource {
  nodes: readonly Pick<
    GraphNode,
    "id" | "kind" | "path" | "qualifiedName" | "range"
  >[];
  edges: readonly (Pick<GraphEdge, "kind" | "sourceId" | "targetId"> &
    Partial<Pick<GraphEdge, "id">>)[];
  edgeSourceLines?: NonNullable<ProjectGraph["edgeSourceLines"]>;
}

/** Read the same resolved links as the indexer without opening a database. */
export async function readWorkingTreeLinks(projectInfo: ProjectInfo) {
  const { project, files, paths, resolution } = await captureRepository({
    project: projectInfo,
  });
  const graph = buildStructuralGraph(project, files, resolution);
  return { paths, links: extractCrossFileLinks(graph) };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareEvidence(
  a: ArchitectureConnectionEvidence,
  b: ArchitectureConnectionEvidence,
): number {
  return (
    compareStrings(a.file, b.file) ||
    a.line - b.line ||
    (a.kind === b.kind ? 0 : a.kind === "import" ? -1 : 1) ||
    compareStrings(a.targetFile, b.targetFile) ||
    compareStrings(a.sourceSymbol ?? "", b.sourceSymbol ?? "") ||
    compareStrings(a.symbol ?? "", b.symbol ?? "")
  );
}

function evidenceKey(item: ArchitectureConnectionEvidence): string {
  return JSON.stringify([
    item.kind,
    item.file,
    item.line,
    item.targetFile,
    item.sourceSymbol ?? "",
    item.symbol ?? "",
  ]);
}

/** Extract resolved cross-file IMPORTS and CALLS links from an in-memory graph. */
export function extractCrossFileLinks(graph: GraphLinkSource): CrossFileLink[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const links: CrossFileLink[] = [];

  for (const edge of graph.edges) {
    if (edge.kind !== "IMPORTS" && edge.kind !== "CALLS") continue;
    const source = nodesById.get(edge.sourceId);
    const target = nodesById.get(edge.targetId);
    if (!source || !target || source.path === target.path) continue;
    const sites =
      edge.id === undefined ? undefined : graph.edgeSourceLines?.get(edge.id);
    const lines = sites ? [...sites.keys()].sort((a, b) => a - b) : [];
    const [firstLine, ...additionalLines] = lines;
    const typeOnlyImportLines = lines.filter((line) => sites?.get(line));
    const link: CrossFileLink = {
      ...(edge.id === undefined ? {} : { edgeId: edge.id }),
      kind: edge.kind,
      sourcePath: source.path,
      sourceLine: firstLine ?? source.range.startLine,
      targetPath: target.path,
    };
    if (additionalLines.length > 0) link.additionalLines = additionalLines;
    if (typeOnlyImportLines.length > 0)
      link.typeOnlyImportLines = typeOnlyImportLines;
    if (firstLine === undefined) link.approximate = true;
    if (source.kind !== "file") link.sourceSymbol = source.qualifiedName;
    if (target.kind !== "file") link.targetSymbol = target.qualifiedName;
    links.push(link);
  }

  return links;
}

/**
 * Aggregate resolved cross-file IMPORTS and CALLS links into directed
 * connections between assigned architecture parts, with counts and evidence.
 */
export function computeArchitectureConnections(
  assignment: ArchitectureAssignment,
  links: readonly CrossFileLink[],
  options: ComputeConnectionsOptions = {},
): ArchitectureConnection[] {
  const { evidenceLimit } = options;
  if (
    evidenceLimit !== undefined &&
    (!Number.isSafeInteger(evidenceLimit) || evidenceLimit < 1)
  ) {
    throw new RangeError("evidenceLimit must be a safe integer >= 1");
  }

  const groups = new Map<
    string,
    {
      sourcePartId: string;
      targetPartId: string;
      seen: Set<string>;
      evidence: ArchitectureConnectionEvidence[];
      importCount: number;
      callCount: number;
    }
  >();

  for (const link of links) {
    const sourcePartId = assignment.fileToPart[link.sourcePath];
    const targetPartId = assignment.fileToPart[link.targetPath];
    if (!sourcePartId || !targetPartId || sourcePartId === targetPartId)
      continue;

    const id = `${sourcePartId}->${targetPartId}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        sourcePartId,
        targetPartId,
        seen: new Set(),
        evidence: [],
        importCount: 0,
        callCount: 0,
      };
      groups.set(id, group);
    }

    const item: ArchitectureConnectionEvidence = {
      ...(link.edgeId === undefined ? {} : { edgeId: link.edgeId }),
      kind: link.kind === "IMPORTS" ? "import" : "call",
      file: link.sourcePath,
      line: link.sourceLine,
      targetFile: link.targetPath,
    };
    if (link.sourceSymbol !== undefined) item.sourceSymbol = link.sourceSymbol;
    if (link.targetSymbol !== undefined) item.symbol = link.targetSymbol;
    if (link.additionalLines?.length)
      item.additionalLines = link.additionalLines;
    if (link.typeOnlyImportLines?.length)
      item.typeOnlyImportLines = link.typeOnlyImportLines;
    if (link.approximate) item.approximate = true;

    const key = evidenceKey(item);
    if (group.seen.has(key)) continue;
    group.seen.add(key);
    group.evidence.push(item);
    if (item.kind === "import") group.importCount++;
    else group.callCount++;
  }

  const connections: ArchitectureConnection[] = [];
  for (const [id, group] of groups) {
    group.evidence.sort(compareEvidence);
    const truncated =
      evidenceLimit !== undefined && group.evidence.length > evidenceLimit;
    const evidence = truncated
      ? group.evidence.slice(0, evidenceLimit)
      : group.evidence;

    connections.push({
      id,
      sourcePartId: group.sourcePartId,
      targetPartId: group.targetPartId,
      count: group.importCount + group.callCount,
      importCount: group.importCount,
      callCount: group.callCount,
      evidence,
      truncated,
    });
  }

  return connections.sort(
    (a, b) =>
      compareStrings(a.sourcePartId, b.sourcePartId) ||
      compareStrings(a.targetPartId, b.targetPartId),
  );
}

/** Query resolved cross-file links from SQLite and aggregate them between parts. */
export function getArchitectureConnections(
  database: SqliteDatabase,
  projectId: ProjectId,
  assignment: ArchitectureAssignment,
  options: ComputeConnectionsOptions = {},
): ArchitectureConnectionsSnapshot {
  const snapshot = getCrossFileLinks(database, projectId);
  return {
    projectId: snapshot.projectId,
    revision: snapshot.revision,
    connections: computeArchitectureConnections(
      assignment,
      snapshot.links,
      options,
    ),
  };
}
