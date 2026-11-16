import type {
  SemanticEntity,
  SemanticFeatureQuery,
  SemanticFeatureList,
  SemanticExtraction,
  SemanticGraph,
  SemanticRelationship,
  SemanticSource,
  SourceRange,
} from "@mycel/shared";
import type { SqliteDatabase } from "./database.js";
import { currentRevision } from "./history.js";

type EntityRow = Omit<
  SemanticEntity,
  "sources" | "attributes" | "provenance"
> & {
  attributes: string;
  provenance: string;
};
type RelationshipRow = Omit<SemanticRelationship, "sources" | "provenance"> & {
  provenance: string;
};
const entityColumns = `id, project_id AS projectId, kind, name, attributes, provenance, revision`;
const relationshipColumns = `id, project_id AS projectId, source_id AS sourceId, target_id AS targetId, kind, provenance, revision`;

/** Called only inside the structural graph transaction, including history commits. */
export function writeSemanticGraph(
  db: SqliteDatabase,
  projectId: string,
  revision: number,
  extraction: SemanticExtraction = { entities: [], relationships: [] },
): void {
  if (!db.inTransaction)
    throw new Error("Semantic writes require a graph transaction");
  db.prepare("DELETE FROM semantic_relationships WHERE project_id = ?").run(
    projectId,
  );
  db.prepare("DELETE FROM semantic_entities WHERE project_id = ?").run(
    projectId,
  );
  const insertEntity = db.prepare(`INSERT INTO semantic_entities
    (project_id, id, kind, name, attributes, provenance, revision) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertRelationship = db.prepare(`INSERT INTO semantic_relationships
    (project_id, id, source_id, target_id, kind, provenance, revision) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertSource = db.prepare(`INSERT INTO semantic_sources
    (project_id, entity_id, relationship_id, node_id, path, start_offset, end_offset, start_line, start_column, end_line, end_column)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const anchor = db.prepare<
    [string, string],
    { path: string; start: number; end: number }
  >(
    "SELECT path, start_offset AS start, end_offset AS end FROM nodes WHERE project_id = ? AND id = ?",
  );
  function sources(
    entityId: string | null,
    relationshipId: string | null,
    items: SemanticSource[],
  ) {
    if (!items.length)
      throw new Error("Semantic records require source evidence");
    for (const source of items) {
      const node = anchor.get(projectId, source.nodeId);
      if (
        !node ||
        node.path !== source.path ||
        source.range.start < node.start ||
        source.range.end > node.end
      )
        throw new Error(
          "Semantic source must map to a real structural node range",
        );
      const r = source.range;
      insertSource.run(
        projectId,
        entityId,
        relationshipId,
        source.nodeId,
        source.path,
        r.start,
        r.end,
        r.startLine,
        r.startColumn,
        r.endLine,
        r.endColumn,
      );
    }
  }
  for (const entity of extraction.entities) {
    if (entity.projectId !== projectId)
      throw new Error("Semantic entity belongs to another project");
    insertEntity.run(
      projectId,
      entity.id,
      entity.kind,
      entity.name,
      JSON.stringify(entity.attributes),
      JSON.stringify(entity.provenance),
      revision,
    );
    sources(entity.id, null, entity.sources);
  }
  for (const relationship of extraction.relationships) {
    if (relationship.projectId !== projectId)
      throw new Error("Semantic relationship belongs to another project");
    insertRelationship.run(
      projectId,
      relationship.id,
      relationship.sourceId,
      relationship.targetId,
      relationship.kind,
      JSON.stringify(relationship.provenance),
      revision,
    );
    sources(null, relationship.id, relationship.sources);
  }
}

function readSources(
  db: SqliteDatabase,
  projectId: string,
  column: "entity_id" | "relationship_id",
  id: string,
): SemanticSource[] {
  return db
    .prepare<[string, string], SourceRange & { nodeId: string; path: string }>(
      `SELECT
    node_id AS nodeId, path, start_offset AS start, end_offset AS end,
    start_line AS startLine, start_column AS startColumn, end_line AS endLine, end_column AS endColumn
    FROM semantic_sources WHERE project_id = ? AND ${column} = ? ORDER BY path, start_offset, node_id`,
    )
    .all(projectId, id)
    .map(({ nodeId, path, ...range }) => ({ nodeId, path, range }));
}

export function readSemanticSelection(
  db: SqliteDatabase,
  projectId: string,
  ids: string[],
  truncated: boolean,
): SemanticGraph {
  const selected = JSON.stringify(ids);
  const entities = db
    .prepare<[string, string], EntityRow>(
      `SELECT ${entityColumns} FROM semantic_entities
    WHERE project_id = ? AND id IN (SELECT value FROM json_each(?)) ORDER BY id`,
    )
    .all(projectId, selected)
    .map((row): SemanticEntity => ({
      ...row,
      attributes: JSON.parse(row.attributes),
      provenance: JSON.parse(row.provenance),
      sources: readSources(db, projectId, "entity_id", row.id),
    }));
  const relationships = db
    .prepare<[string, string, string], RelationshipRow>(
      `SELECT ${relationshipColumns} FROM semantic_relationships
    WHERE project_id = ? AND source_id IN (SELECT value FROM json_each(?))
    AND target_id IN (SELECT value FROM json_each(?)) ORDER BY id`,
    )
    .all(projectId, selected, selected)
    .map((row): SemanticRelationship => ({
      ...row,
      provenance: JSON.parse(row.provenance),
      sources: readSources(db, projectId, "relationship_id", row.id),
    }));
  return {
    projectId,
    revision: currentRevision(db, projectId),
    entities,
    relationships,
    truncated,
  };
}

function validateLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
    throw new RangeError("Semantic limit must be an integer between 1 and 500");
}

/** Bounded current-state snapshot; every returned relationship has both endpoints. */
export function getSemanticGraph(
  db: SqliteDatabase,
  projectId: string,
  limit = 100,
): SemanticGraph {
  validateLimit(limit);
  return db.transaction(() => {
    const rows = db
      .prepare<[string, number], { id: string }>(
        "SELECT id FROM semantic_entities WHERE project_id = ? ORDER BY id LIMIT ?",
      )
      .all(projectId, limit + 1);
    return readSemanticSelection(
      db,
      projectId,
      rows.slice(0, limit).map((row) => row.id),
      rows.length > limit,
    );
  })();
}

/** Traverse both incoming and outgoing semantic relationships, at most five hops. */
export function getSemanticNeighborhood(
  db: SqliteDatabase,
  projectId: string,
  id: string,
  depth = 1,
  limit = 100,
): SemanticGraph | undefined {
  validateLimit(limit);
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > 5)
    throw new RangeError("Semantic depth must be an integer between 0 and 5");
  return db.transaction(() => {
    if (
      !db
        .prepare(
          "SELECT 1 FROM semantic_entities WHERE project_id = ? AND id = ?",
        )
        .get(projectId, id)
    )
      return;
    const visited = new Set([id]);
    let frontier = [id];
    let truncated = false;
    for (let level = 0; level < depth && frontier.length; level++) {
      const encoded = JSON.stringify(frontier);
      const remaining = limit - visited.size;
      // Separate outer query avoids SQLite resolving 'id' to the relationship's own id.
      const rows = db
        .prepare<
          [string, string, string, string, string, number],
          { id: string }
        >(
          `SELECT DISTINCT neighbor AS id FROM (
        SELECT CASE WHEN source_id IN (SELECT value FROM json_each(?)) THEN target_id ELSE source_id END AS neighbor
        FROM semantic_relationships WHERE project_id = ?
        AND (source_id IN (SELECT value FROM json_each(?)) OR target_id IN (SELECT value FROM json_each(?)))
      ) WHERE neighbor NOT IN (SELECT value FROM json_each(?)) ORDER BY neighbor LIMIT ?`,
        )
        .all(
          encoded,
          projectId,
          encoded,
          encoded,
          JSON.stringify([...visited]),
          remaining + 1,
        );
      truncated ||= rows.length > remaining;
      frontier = rows.slice(0, remaining).map((row) => row.id);
      for (const neighbor of frontier) visited.add(neighbor);
      if (truncated) break;
    }
    return readSemanticSelection(db, projectId, [...visited], truncated);
  })();
}

/** Lists declarations separately from heuristic candidates, including legacy declarations. */
export function getSemanticFeatures(
  db: SqliteDatabase,
  projectId: string,
  { status, limit = 100 }: SemanticFeatureQuery = {},
): SemanticFeatureList {
  validateLimit(limit);
  if (status !== undefined && status !== "candidate" && status !== "declared")
    throw new RangeError("Feature status must be candidate or declared");
  return db.transaction(() => {
    const rows = db
      .prepare<[string, string | null, string | null, number], { id: string }>(
        `SELECT id FROM semantic_entities
      WHERE project_id = ? AND kind = 'feature' AND (? IS NULL OR
        COALESCE(json_extract(attributes, '$.status'), CASE WHEN json_extract(provenance, '$.kind') = 'deterministic' THEN 'declared' ELSE 'candidate' END) = ?)
      ORDER BY name, id LIMIT ?`,
      )
      .all(projectId, status ?? null, status ?? null, limit + 1);
    const graph = readSemanticSelection(
      db,
      projectId,
      rows.slice(0, limit).map((row) => row.id),
      rows.length > limit,
    );
    const byId = new Map(graph.entities.map((entity) => [entity.id, entity]));
    return {
      projectId,
      revision: graph.revision,
      features: rows.slice(0, limit).map((row) => byId.get(row.id)!),
      truncated: graph.truncated,
    };
  })();
}

/** Direct feature memberships only; the limit includes the feature itself. */
export function getSemanticFeature(
  db: SqliteDatabase,
  projectId: string,
  id: string,
  limit = 100,
): SemanticGraph | undefined {
  validateLimit(limit);
  return db.transaction(() => {
    if (
      !db
        .prepare(
          "SELECT 1 FROM semantic_entities WHERE project_id = ? AND id = ? AND kind = 'feature'",
        )
        .get(projectId, id)
    )
      return;
    const rows = db
      .prepare<[string, string, number], { id: string }>(
        `SELECT DISTINCT source_id AS id FROM semantic_relationships
      WHERE project_id = ? AND target_id = ? AND kind = 'IMPLEMENTS' ORDER BY source_id LIMIT ?`,
      )
      .all(projectId, id, limit);
    const graph = readSemanticSelection(
      db,
      projectId,
      [id, ...rows.slice(0, limit - 1).map((row) => row.id)],
      rows.length > limit - 1,
    );
    graph.relationships = graph.relationships.filter(
      (edge) => edge.kind === "IMPLEMENTS" && edge.targetId === id,
    );
    return graph;
  })();
}
