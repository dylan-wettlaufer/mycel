import type {
  ChangeAction,
  ChangeEvent,
  GraphEdge,
  GraphNode,
} from "@mycel/shared";
import type { SqliteDatabase } from "./database.js";
import type { ProjectGraph } from "./graph.js";
import { applyProjectGraph } from "./graph.js";
import { getNode } from "./queries.js";

type Entity = Omit<GraphNode, "revision"> | Omit<GraphEdge, "revision">;
export interface EntityChange {
  entityType: "node" | "edge";
  entityId: string;
  action: ChangeAction;
  path: string;
  before: Entity | null;
  after: Entity | null;
}
export interface ChangeSet {
  graph: ProjectGraph;
  /** Complete source capture corresponding to the graph, including retained files. */
  sources: ReadonlyMap<string, string>;
  changes: readonly EntityChange[];
  sessionId?: string;
}
export function currentRevision(db: SqliteDatabase, projectId: string): number {
  return db
    .prepare<[string], { revision: number }>(
      "SELECT COALESCE(MAX(revision), 0) AS revision FROM revisions WHERE project_id = ?",
    )
    .get(projectId)!.revision;
}
export function readGraphState(db: SqliteDatabase, projectId: string) {
  return {
    nodes: db
      .prepare<[string], { id: string }>(
        "SELECT id FROM nodes WHERE project_id = ? ORDER BY id",
      )
      .all(projectId)
      .map(({ id }) => getNode(db, projectId, id)!),
    edges: db
      .prepare<[string], GraphEdge>(
        "SELECT id, project_id AS projectId, source_id AS sourceId, target_id AS targetId, kind, revision FROM edges WHERE project_id = ? ORDER BY id",
      )
      .all(projectId),
  };
}
interface EventRow {
  id: number;
  projectId: string;
  timestamp: string;
  entityType: "node" | "edge";
  entityId: string;
  action: ChangeAction;
  path: string;
  beforeRevision: number | null;
  afterRevision: number | null;
  before: string | null;
  after: string | null;
  sessionId: string | null;
  attribution: string | null;
}
const eventColumns = `id, project_id AS projectId, timestamp, entity_type AS entityType,
  entity_id AS entityId, action, path, before_revision AS beforeRevision,
  after_revision AS afterRevision, before_entity AS before, after_entity AS after,
  session_id AS sessionId, attribution`;
function toEvent(row: EventRow): ChangeEvent {
  const { sessionId, attribution, ...rest } = row;
  return {
    ...rest,
    id: String(row.id),
    before: row.before === null ? null : JSON.parse(row.before),
    after: row.after === null ? null : JSON.parse(row.after),
    ...(sessionId === null ? {} : { sessionId }),
    ...(attribution === null ? {} : { attribution: JSON.parse(attribution) }),
  };
}
/** Nested graph writes use SQLite savepoints; all history rolls back on any failure. */
export function commitChangeSet(db: SqliteDatabase, set: ChangeSet) {
  return db
    .transaction(() => {
      const projectId = set.graph.project.id;
      const previous = currentRevision(db, projectId);
      if (
        set.sessionId &&
        !db
          .prepare("SELECT 1 FROM sessions WHERE id = ? AND project_id = ?")
          .get(set.sessionId, projectId)
      )
        throw new Error("Session does not belong to project");
      const revision = applyProjectGraph(db, set.graph);
      const snapshot = db.prepare(
        "INSERT INTO snapshots (project_id, path, revision, content) VALUES (?, ?, ?, ?)",
      );
      for (const [path, content] of set.sources)
        snapshot.run(projectId, path, revision, content);
      const timestamp = new Date().toISOString();
      const insert = db.prepare(`INSERT INTO change_events
      (project_id, timestamp, entity_type, entity_id, action, path, before_revision, after_revision, before_entity, after_entity, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const events = set.changes.map((change) => {
        const beforeRevision = change.before === null ? null : previous;
        const afterRevision = change.after === null ? null : revision;
        const before =
          change.before === null
            ? null
            : { ...change.before, revision: beforeRevision! };
        const after =
          change.after === null
            ? null
            : { ...change.after, revision: afterRevision! };
        const result = insert.run(
          projectId,
          timestamp,
          change.entityType,
          change.entityId,
          change.action,
          change.path,
          beforeRevision,
          afterRevision,
          before === null ? null : JSON.stringify(before),
          after === null ? null : JSON.stringify(after),
          set.sessionId ?? null,
        );
        const event: ChangeEvent = {
          id: String(result.lastInsertRowid),
          projectId,
          timestamp,
          entityType: change.entityType,
          entityId: change.entityId,
          action: change.action,
          path: change.path,
          beforeRevision,
          afterRevision,
          before,
          after,
          ...(set.sessionId ? { sessionId: set.sessionId } : {}),
        };
        return event;
      });
      return { revision, events };
    })
    .immediate();
}

export function parseChangeId(id: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(id) || !Number.isSafeInteger(Number(id)))
    throw new RangeError("Invalid event cursor");
  return Number(id);
}
function historyLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new RangeError("History limit must be between 1 and 1000");
  return limit;
}
/** Newest first; the cursor is exclusive and stable when newer events arrive. */
export function listChanges(
  db: SqliteDatabase,
  projectId: string,
  cursor?: string,
  limit = 50,
): import("@mycel/shared").ChangesPage {
  historyLimit(limit);
  const rows = db
    .prepare<[string, number, number], EventRow>(
      `SELECT ${eventColumns} FROM change_events WHERE project_id = ? AND id < ? ORDER BY id DESC LIMIT ?`,
    )
    .all(
      projectId,
      cursor === undefined ? Number.MAX_SAFE_INTEGER : parseChangeId(cursor),
      limit + 1,
    );
  return {
    items: rows.slice(0, limit).map(toEvent),
    cursor: rows.length > limit ? String(rows[limit - 1]!.id) : null,
  };
}

/** Oldest first; bounded replay batches prevent unbounded allocations. */
export function getEventsAfter(
  db: SqliteDatabase,
  projectId: string,
  id = "0",
  limit = 1000,
): ChangeEvent[] {
  historyLimit(limit);
  return db
    .prepare<[string, number, number], EventRow>(
      `SELECT ${eventColumns} FROM change_events WHERE project_id = ? AND id > ? ORDER BY id LIMIT ?`,
    )
    .all(projectId, parseChangeId(id), limit)
    .map(toEvent);
}

export function getDiff(
  db: SqliteDatabase,
  projectId: string,
  id: string,
): import("@mycel/shared").ChangeDiff | undefined {
  const row = db
    .prepare<[string, number], EventRow>(
      `SELECT ${eventColumns} FROM change_events WHERE project_id = ? AND id = ?`,
    )
    .get(projectId, parseChangeId(id));
  if (!row) return undefined;
  const content = (revision: number | null) => {
    if (revision === null) return null;
    return (
      db
        .prepare<[string, string, number], { content: string }>(
          "SELECT content FROM snapshots WHERE project_id = ? AND path = ? AND revision = ?",
        )
        .get(projectId, row.path, revision)?.content ?? null
    );
  };
  return {
    changeId: id,
    path: row.path,
    beforeContent: content(row.beforeRevision),
    afterContent: content(row.afterRevision),
    beforeRevision: row.beforeRevision,
    afterRevision: row.afterRevision,
  };
}
