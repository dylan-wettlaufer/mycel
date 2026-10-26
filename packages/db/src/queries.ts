import type {
  Diagnostic,
  GraphEdge,
  GraphNode,
  Neighborhood,
  NodeId,
  NodeDetails,
  NodeList,
  ProjectId,
  SearchResult,
  SourceRange,
} from "@mycel/shared";
import type { SqliteDatabase } from "./database.js";

type NodeRow = Omit<GraphNode, "range"> & SourceRange;

const nodeColumns = `n.id, n.project_id AS projectId, n.kind, n.name,
  n.qualified_name AS qualifiedName, n.path, n.content_hash AS contentHash,
  n.revision, n.start_offset AS start, n.end_offset AS end,
  n.start_line AS startLine, n.start_column AS startColumn,
  n.end_line AS endLine, n.end_column AS endColumn`;

function toNode(row: NodeRow): GraphNode {
  const { start, end, startLine, startColumn, endLine, endColumn, ...node } =
    row;
  return {
    ...node,
    range: { start, end, startLine, startColumn, endLine, endColumn },
  };
}

function validateInteger(name: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
}

function probeLimit(limit: number): number {
  return Math.min(limit + 1, Number.MAX_SAFE_INTEGER);
}

function nodeList(rows: NodeRow[], limit: number): NodeList {
  return {
    nodes: rows.slice(0, limit).map(toNode),
    truncated: rows.length > limit,
  };
}

function getRevision(database: SqliteDatabase, projectId: ProjectId): number {
  return database
    .prepare<[string], { revision: number }>(
      "SELECT COALESCE(MAX(revision), 0) AS revision FROM revisions WHERE project_id = ?",
    )
    .get(projectId)!.revision;
}

/** Look up a node only within the supplied project. */
export function getNode(
  database: SqliteDatabase,
  projectId: ProjectId,
  id: NodeId,
): GraphNode | undefined {
  const row = database
    .prepare<[string, string], NodeRow>(
      `SELECT ${nodeColumns} FROM nodes n WHERE n.project_id = ? AND n.id = ?`,
    )
    .get(projectId, id);
  return row && toNode(row);
}

/** Literal, ASCII case-insensitive search of file/symbol names and paths. */
export function searchSymbols(
  database: SqliteDatabase,
  projectId: ProjectId,
  query: string,
  limit = 20,
): SearchResult {
  validateInteger("limit", limit, 1);
  const q = query.trim();
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  return database.transaction(() => {
    const revision = getRevision(database, projectId);
    const rows = q
      ? database
          .prepare<
            {
              projectId: string;
              q: string;
              prefix: string;
              match: string;
              limit: number;
            },
            NodeRow
          >(
            `SELECT ${nodeColumns} FROM nodes n
            WHERE n.project_id = @projectId AND (
              n.name LIKE @match ESCAPE '\\' OR
              n.qualified_name LIKE @match ESCAPE '\\' OR
              n.path LIKE @match ESCAPE '\\'
            )
            ORDER BY CASE
              WHEN n.name = @q COLLATE NOCASE OR n.qualified_name = @q COLLATE NOCASE
                OR n.path = @q COLLATE NOCASE THEN 0
              WHEN n.name LIKE @prefix ESCAPE '\\' OR
                n.qualified_name LIKE @prefix ESCAPE '\\' OR
                n.path LIKE @prefix ESCAPE '\\' THEN 1
              ELSE 2 END,
              n.name COLLATE NOCASE, n.qualified_name, n.path, n.id
            LIMIT @limit`,
          )
          .all({
            projectId,
            q,
            prefix: `${escaped}%`,
            match: `%${escaped}%`,
            limit: probeLimit(limit),
          })
      : [];
    return { projectId, revision, ...nodeList(rows, limit) };
  })();
}

/** Traverse all edge kinds in both directions, limiting nodes including root. */
export function getNeighborhood(
  database: SqliteDatabase,
  projectId: ProjectId,
  id: NodeId,
  depth = 1,
  limit = 100,
): Neighborhood | undefined {
  validateInteger("depth", depth, 0);
  validateInteger("limit", limit, 1);
  return database.transaction(() => {
    const root = getNode(database, projectId, id);
    if (!root) return undefined;
    const revision = getRevision(database, projectId);
    const nodes = [root];
    const visited = new Set([id]);
    let frontier = [id];
    let truncated = false;
    const adjacent = database.prepare<
      { projectId: string; id: string; visited: string; limit: number },
      NodeRow
    >(`SELECT ${nodeColumns} FROM nodes n JOIN (
        SELECT target_id AS id FROM edges WHERE project_id = @projectId AND source_id = @id
        UNION
        SELECT source_id AS id FROM edges WHERE project_id = @projectId AND target_id = @id
      ) adjacent ON adjacent.id = n.id
      WHERE n.project_id = @projectId AND n.id NOT IN (SELECT value FROM json_each(@visited))
      ORDER BY n.id LIMIT @limit`);

    traversal: for (let level = 0; level < depth && frontier.length; level++) {
      const next: NodeId[] = [];
      for (const current of frontier) {
        const remaining = limit - nodes.length;
        const rows = adjacent.all({
          projectId,
          id: current,
          visited: JSON.stringify([...visited]),
          limit: probeLimit(remaining),
        });
        for (const row of rows.slice(0, remaining)) {
          visited.add(row.id);
          nodes.push(toNode(row));
          next.push(row.id);
        }
        if (rows.length > remaining) {
          truncated = true;
          break traversal;
        }
      }
      frontier = next;
    }

    const edges = database
      .prepare<{ projectId: string; ids: string }, GraphEdge>(
        `SELECT e.id, e.project_id AS projectId, e.source_id AS sourceId,
          e.target_id AS targetId, e.kind, e.revision FROM edges e
        WHERE e.project_id = @projectId
          AND e.source_id IN (SELECT value FROM json_each(@ids))
          AND e.target_id IN (SELECT value FROM json_each(@ids))
        ORDER BY e.id`,
      )
      .all({ projectId, ids: JSON.stringify([...visited]) });
    return { projectId, revision, rootId: id, nodes, edges, truncated };
  })();
}

/** Direct incoming CALLS sources, deduplicated and bounded. */
export function getCallers(
  database: SqliteDatabase,
  projectId: ProjectId,
  id: NodeId,
  limit = 100,
): NodeList {
  validateInteger("limit", limit, 1);
  const rows = database.prepare<[string, string, string, number], NodeRow>(
    `SELECT ${nodeColumns} FROM nodes n JOIN (
        SELECT DISTINCT source_id AS id FROM edges
        WHERE project_id = ? AND target_id = ? AND kind = 'CALLS'
      ) callers ON callers.id = n.id
      WHERE n.project_id = ?
      ORDER BY n.name COLLATE NOCASE, n.qualified_name, n.path, n.id LIMIT ?`,
  );
  return nodeList(rows.all(projectId, id, projectId, probeLimit(limit)), limit);
}

/** Direct outgoing CALLS/IMPORTS targets; containment is not a dependency. */
export function getDependencies(
  database: SqliteDatabase,
  projectId: ProjectId,
  id: NodeId,
  limit = 100,
): NodeList {
  validateInteger("limit", limit, 1);
  const rows = database.prepare<[string, string, string, number], NodeRow>(
    `SELECT ${nodeColumns} FROM nodes n JOIN (
        SELECT DISTINCT target_id AS id FROM edges
        WHERE project_id = ? AND source_id = ? AND kind IN ('CALLS', 'IMPORTS')
      ) dependencies ON dependencies.id = n.id
      WHERE n.project_id = ?
      ORDER BY n.name COLLATE NOCASE, n.qualified_name, n.path, n.id LIMIT ?`,
  );
  return nodeList(rows.all(projectId, id, projectId, probeLimit(limit)), limit);
}

/** Node metadata and direct relationships from one consistent graph snapshot. */
export function getNodeDetails(
  database: SqliteDatabase,
  projectId: ProjectId,
  id: NodeId,
  limit = 100,
): NodeDetails | undefined {
  validateInteger("limit", limit, 1);
  return database.transaction(() => {
    const node = getNode(database, projectId, id);
    if (!node) return undefined;
    const revision = getRevision(database, projectId);
    const callers = getCallers(database, projectId, id, limit);
    const dependencies = getDependencies(database, projectId, id, limit);
    // Include the owning file and files of all direct callers/dependencies,
    // independently of the limits on those two lists.
    const files = database.prepare<
      { projectId: string; id: string; path: string; limit: number },
      NodeRow
    >(`SELECT ${nodeColumns} FROM nodes n
      WHERE n.project_id = @projectId AND n.kind = 'file' AND (
        n.path = @path OR n.path IN (
          SELECT related.path FROM nodes related JOIN (
            SELECT source_id AS id FROM edges
              WHERE project_id = @projectId AND target_id = @id AND kind = 'CALLS'
            UNION
            SELECT target_id AS id FROM edges
              WHERE project_id = @projectId AND source_id = @id AND kind IN ('CALLS', 'IMPORTS')
          ) endpoints ON endpoints.id = related.id
          WHERE related.project_id = @projectId
        )
      ) ORDER BY CASE WHEN n.path = @path THEN 0 ELSE 1 END, n.path, n.id
      LIMIT @limit`);
    const diagnostics = database
      .prepare<[string, string], Omit<Diagnostic, "range"> & SourceRange>(
        `SELECT path, severity, source, code, message,
          start_offset AS start, end_offset AS end,
          start_line AS startLine, start_column AS startColumn,
          end_line AS endLine, end_column AS endColumn
        FROM diagnostics WHERE project_id = ? AND path = ?
        ORDER BY start_offset, end_offset, id`,
      )
      .all(projectId, node.path)
      .map((row): Diagnostic => {
        const {
          start,
          end,
          startLine,
          startColumn,
          endLine,
          endColumn,
          ...fields
        } = row;
        return {
          ...fields,
          range: { start, end, startLine, startColumn, endLine, endColumn },
        };
      });
    return {
      projectId,
      revision,
      node,
      callers,
      dependencies,
      relatedFiles: nodeList(
        files.all({ projectId, id, path: node.path, limit: probeLimit(limit) }),
        limit,
      ),
      diagnostics,
    };
  })();
}
