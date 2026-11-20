import type {
  Diagnostic,
  GraphEdge,
  GraphNode,
  Project,
  Revision,
  SourceRange,
  SemanticExtraction,
} from "@mycel/shared";
import type { SqliteDatabase } from "./database.js";
import { writeSemanticGraph } from "./semantic.js";
import { resolveExternalDatabasePath } from "./paths.js";

export interface ProjectGraph {
  project: Project;
  nodes: readonly Omit<GraphNode, "revision">[];
  edges: readonly Omit<GraphEdge, "revision">[];
  /** Indexed locations by edge id and source line. A true value marks a type-only import. */
  edgeSourceLines?: ReadonlyMap<string, ReadonlyMap<number, boolean>>;
  /** Inclusive end lines for multiline sites, keyed by edge id and start line. */
  edgeSourceEndLines?: ReadonlyMap<string, ReadonlyMap<number, number>>;
  diagnostics: readonly Diagnostic[];
  semantic?: SemanticExtraction;
}

function rangeParameters(range: SourceRange) {
  return {
    start: range.start,
    end: range.end,
    startLine: range.startLine,
    startColumn: range.startColumn,
    endLine: range.endLine,
    endColumn: range.endColumn,
  };
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return JSON.stringify([
    diagnostic.path,
    diagnostic.severity,
    diagnostic.source,
    diagnostic.code,
    diagnostic.message,
    ...Object.values(rangeParameters(diagnostic.range)),
  ]);
}

/** Keep unchanged diagnostics (including duplicates) and remove obsolete records. */
function reconcileDiagnostics(
  database: SqliteDatabase,
  graph: ProjectGraph,
): Diagnostic[] {
  const remaining = new Map<
    string,
    { diagnostic: Diagnostic; count: number }
  >();
  for (const diagnostic of graph.diagnostics) {
    const key = diagnosticKey(diagnostic);
    const entry = remaining.get(key);
    if (entry) entry.count++;
    else remaining.set(key, { diagnostic, count: 1 });
  }
  const rows = database
    .prepare<
      [string],
      Omit<Diagnostic, "range"> & SourceRange & { id: number }
    >(
      `
    SELECT id, path, severity, source, code, message,
      start_offset AS start, end_offset AS end, start_line AS startLine,
      start_column AS startColumn, end_line AS endLine, end_column AS endColumn
    FROM diagnostics WHERE project_id = ? ORDER BY id`,
    )
    .all(graph.project.id);
  const remove = database.prepare(
    "DELETE FROM diagnostics WHERE project_id = ? AND id = ?",
  );
  for (const row of rows) {
    const entry = remaining.get(diagnosticKey({ ...row, range: row }));
    if (entry && entry.count > 0) entry.count--;
    else remove.run(graph.project.id, row.id);
  }
  return [...remaining.values()].flatMap(({ diagnostic, count }) =>
    Array.from({ length: count }, () => diagnostic),
  );
}

/** Replace one project's current graph and allocate its revision atomically. */
export function replaceProjectGraph(
  database: SqliteDatabase,
  graph: ProjectGraph,
): Revision {
  return writeProjectGraph(database, graph, false);
}

/** Reconcile a graph while preserving records whose content has not changed. */
export function applyProjectGraph(
  database: SqliteDatabase,
  graph: ProjectGraph,
): Revision {
  return writeProjectGraph(database, graph, true);
}

function writeProjectGraph(
  database: SqliteDatabase,
  graph: ProjectGraph,
  incremental: boolean,
): Revision {
  const { project } = graph;
  if (!database.memory)
    resolveExternalDatabasePath(project.root, database.name);
  if (
    graph.nodes.some((node) => node.projectId !== project.id) ||
    graph.edges.some((edge) => edge.projectId !== project.id)
  ) {
    throw new Error("Every graph record must belong to the indexed project");
  }
  if (database.pragma("foreign_keys", { simple: true }) !== 1) {
    throw new Error("Graph writes require foreign keys to be enabled");
  }
  return database
    .transaction(() => {
      const existing = database
        .prepare<[string], { root: string }>(
          "SELECT root FROM projects WHERE id = ?",
        )
        .get(project.id);
      if (existing && existing.root !== project.root)
        throw new Error(
          "A project identity cannot be reassigned to a different root",
        );
      database
        .prepare(
          `INSERT INTO projects (id, name, root, indexing_settings) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, indexing_settings = excluded.indexing_settings`,
        )
        .run(
          project.id,
          project.name,
          project.root,
          JSON.stringify(project.indexing),
        );
      const previous =
        database
          .prepare<[string], { revision: number }>(
            "SELECT COALESCE(MAX(revision), 0) AS revision FROM revisions WHERE project_id = ?",
          )
          .get(project.id)?.revision ?? 0;
      const revision = previous + 1;
      if (!Number.isSafeInteger(revision))
        throw new Error("Project revision exceeds the supported integer range");
      database
        .prepare("INSERT INTO revisions (project_id, revision) VALUES (?, ?)")
        .run(project.id, revision);
      if (incremental) {
        database
          .prepare(
            `DELETE FROM edges WHERE project_id = ?
          AND id NOT IN (SELECT value FROM json_each(?))`,
          )
          .run(project.id, JSON.stringify(graph.edges.map((edge) => edge.id)));
        database
          .prepare(
            `DELETE FROM nodes WHERE project_id = ?
          AND id NOT IN (SELECT value FROM json_each(?))`,
          )
          .run(project.id, JSON.stringify(graph.nodes.map((node) => node.id)));
      } else {
        database
          .prepare("DELETE FROM edges WHERE project_id = ?")
          .run(project.id);
        database
          .prepare("DELETE FROM nodes WHERE project_id = ?")
          .run(project.id);
      }
      const diagnostics = incremental
        ? reconcileDiagnostics(database, graph)
        : graph.diagnostics;
      if (!incremental)
        database
          .prepare("DELETE FROM diagnostics WHERE project_id = ?")
          .run(project.id);

      const insertNode = database.prepare(`INSERT INTO nodes (
      project_id, id, kind, name, qualified_name, path,
      start_offset, end_offset, start_line, start_column, end_line, end_column,
      content_hash, revision
    ) VALUES (
      @projectId, @id, @kind, @name, @qualifiedName, @path,
      @start, @end, @startLine, @startColumn, @endLine, @endColumn,
      @contentHash, @revision
    ) ${
      incremental
        ? `ON CONFLICT(project_id, id) DO UPDATE SET
      kind = excluded.kind, name = excluded.name, qualified_name = excluded.qualified_name,
      path = excluded.path, start_offset = excluded.start_offset, end_offset = excluded.end_offset,
      start_line = excluded.start_line, start_column = excluded.start_column,
      end_line = excluded.end_line, end_column = excluded.end_column,
      content_hash = excluded.content_hash, revision = excluded.revision
      WHERE (nodes.kind, nodes.name, nodes.qualified_name, nodes.path,
        nodes.start_offset, nodes.end_offset, nodes.start_line, nodes.start_column,
        nodes.end_line, nodes.end_column, nodes.content_hash)
      IS NOT (excluded.kind, excluded.name, excluded.qualified_name, excluded.path,
        excluded.start_offset, excluded.end_offset, excluded.start_line, excluded.start_column,
        excluded.end_line, excluded.end_column, excluded.content_hash)`
        : ""
    }`);
      for (const node of graph.nodes) {
        const { range, ...fields } = node;
        insertNode.run({ ...fields, ...rangeParameters(range), revision });
      }
      const insertEdge =
        database.prepare(`INSERT INTO edges (project_id, id, source_id, target_id, kind, revision, source_lines, type_only_import_lines, source_end_lines)
      VALUES (@projectId, @id, @sourceId, @targetId, @kind, @revision, @sourceLines, @typeOnlyImportLines, @sourceEndLines)
      ${
        incremental
          ? `ON CONFLICT(project_id, id) DO UPDATE SET
        source_id = excluded.source_id, target_id = excluded.target_id,
        kind = excluded.kind, revision = excluded.revision, source_lines = excluded.source_lines,
        source_end_lines = excluded.source_end_lines,
        type_only_import_lines = excluded.type_only_import_lines
        WHERE (edges.source_id, edges.target_id, edges.kind, edges.source_lines, edges.type_only_import_lines, edges.source_end_lines)
        IS NOT (excluded.source_id, excluded.target_id, excluded.kind, excluded.source_lines, excluded.type_only_import_lines, excluded.source_end_lines)`
          : ""
      }`);
      for (const edge of graph.edges) {
        const sites = graph.edgeSourceLines?.get(edge.id);
        const lines = sites ? [...sites.keys()].sort((a, b) => a - b) : [];
        const typeOnlyImportLines = lines.filter((line) => sites?.get(line));
        const ends = graph.edgeSourceEndLines?.get(edge.id);
        insertEdge.run({
          ...edge,
          revision,
          sourceLines: lines.length ? JSON.stringify(lines) : null,
          sourceEndLines: ends?.size
            ? JSON.stringify(Object.fromEntries(ends))
            : null,
          typeOnlyImportLines: typeOnlyImportLines.length
            ? JSON.stringify(typeOnlyImportLines)
            : null,
        });
      }
      const insertDiagnostic = database.prepare(`INSERT INTO diagnostics (
      project_id, path, start_offset, end_offset, start_line, start_column, end_line, end_column,
      severity, source, code, message, revision
    ) VALUES (
      @projectId, @path, @start, @end, @startLine, @startColumn, @endLine, @endColumn,
      @severity, @source, @code, @message, @revision
    )`);
      for (const diagnostic of diagnostics) {
        const { range, ...fields } = diagnostic;
        insertDiagnostic.run({
          ...fields,
          ...rangeParameters(range),
          projectId: project.id,
          revision,
        });
      }
      writeSemanticGraph(database, project.id, revision, graph.semantic);
      return revision;
    })
    .immediate();
}
