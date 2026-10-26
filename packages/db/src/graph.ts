import type {
  Diagnostic,
  GraphEdge,
  GraphNode,
  Project,
  Revision,
  SourceRange,
} from "@mycel/shared";
import type { SqliteDatabase } from "./database.js";
import { resolveExternalDatabasePath } from "./paths.js";

export interface ProjectGraph {
  project: Project;
  nodes: readonly Omit<GraphNode, "revision">[];
  edges: readonly Omit<GraphEdge, "revision">[];
  diagnostics: readonly Diagnostic[];
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

/** Replace one project's current graph and allocate its revision atomically. */
export function replaceProjectGraph(
  database: SqliteDatabase,
  graph: ProjectGraph,
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
      database
        .prepare("DELETE FROM edges WHERE project_id = ?")
        .run(project.id);
      database
        .prepare("DELETE FROM nodes WHERE project_id = ?")
        .run(project.id);
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
    )`);
      for (const node of graph.nodes) {
        const { range, ...fields } = node;
        insertNode.run({ ...fields, ...rangeParameters(range), revision });
      }
      const insertEdge =
        database.prepare(`INSERT INTO edges (project_id, id, source_id, target_id, kind, revision)
      VALUES (@projectId, @id, @sourceId, @targetId, @kind, @revision)`);
      for (const edge of graph.edges) insertEdge.run({ ...edge, revision });
      const insertDiagnostic = database.prepare(`INSERT INTO diagnostics (
      project_id, path, start_offset, end_offset, start_line, start_column, end_line, end_column,
      severity, source, code, message, revision
    ) VALUES (
      @projectId, @path, @start, @end, @startLine, @startColumn, @endLine, @endColumn,
      @severity, @source, @code, @message, @revision
    )`);
      for (const diagnostic of graph.diagnostics) {
        const { range, ...fields } = diagnostic;
        insertDiagnostic.run({
          ...fields,
          ...rangeParameters(range),
          projectId: project.id,
          revision,
        });
      }
      return revision;
    })
    .immediate();
}
