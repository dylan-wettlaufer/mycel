import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { ParseResult } from "@mycel/parser";
import type { ProjectGraph } from "@mycel/db";
import type {
  Diagnostic,
  GraphEdge,
  GraphNode,
  Project,
  SourceRange,
} from "@mycel/shared";

export const hashContent = (source: string): string =>
  createHash("sha256").update(source, "utf8").digest("hex");
export const hashIdentity = (parts: readonly string[]): string =>
  hashContent(JSON.stringify(parts));

export interface CapturedFile {
  source: string;
  parsed: ParseResult;
}

function fileRange(source: string): SourceRange {
  let endLine = 1;
  for (const character of source) if (character === "\n") endLine++;
  return {
    start: 0,
    end: source.length,
    startLine: 1,
    startColumn: 1,
    endLine,
    endColumn: source.length - source.lastIndexOf("\n"),
  };
}

export function buildProjectGraph(
  project: Project,
  files: readonly CapturedFile[],
): ProjectGraph {
  const nodes: Omit<GraphNode, "revision">[] = [];
  const edges: Omit<GraphEdge, "revision">[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const { source, parsed } of files) {
    const ids = new Map<string, string>();
    const fileId = `node:${hashIdentity([project.id, parsed.fileId])}`;
    ids.set(parsed.fileId, fileId);
    nodes.push({
      id: fileId,
      projectId: project.id,
      kind: "file",
      name: posix.basename(parsed.path),
      qualifiedName: parsed.path,
      path: parsed.path,
      range: fileRange(source),
      contentHash: hashContent(source),
    });
    for (const symbol of parsed.symbols) {
      const id = `node:${hashIdentity([project.id, symbol.id])}`;
      ids.set(symbol.id, id);
      nodes.push({
        id,
        projectId: project.id,
        kind: symbol.kind,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        path: parsed.path,
        range: symbol.range,
        contentHash: hashContent(
          source.slice(symbol.range.start, symbol.range.end),
        ),
      });
    }
    for (const containment of parsed.contains) {
      const sourceId = ids.get(containment.parentId);
      const targetId = ids.get(containment.childId);
      if (!sourceId || !targetId)
        throw new Error(`Missing containment endpoint in ${parsed.path}`);
      edges.push({
        id: `edge:${hashIdentity([project.id, "CONTAINS", sourceId, targetId])}`,
        projectId: project.id,
        kind: "CONTAINS",
        sourceId,
        targetId,
      });
    }
    diagnostics.push(...parsed.diagnostics);
  }
  return { project, nodes, edges, diagnostics };
}
