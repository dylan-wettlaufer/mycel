import type {
  ChangeAction,
  ChangeEvent,
  ChangesQuery,
  FileChangeSummary,
  GraphEdge,
  GraphNode,
  RecordedRelationship,
} from "@mycel/shared";
import type { SqliteDatabase } from "./database.js";
import type { ProjectGraph } from "./graph.js";
import { applyProjectGraph } from "./graph.js";
import { getNode } from "./queries.js";
import { getCallFeatures } from "./behaviour.js";
import { attributeFileChange } from "./agents.js";

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
  /** Wall-clock capture times for changed files from the live watcher. */
  fileCaptureTimes?: ReadonlyMap<string, number>;
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
  relationship: string | null;
}
const eventColumns = `id, project_id AS projectId, timestamp, entity_type AS entityType,
  entity_id AS entityId, action, path, before_revision AS beforeRevision,
  after_revision AS afterRevision, before_entity AS before, after_entity AS after,
  session_id AS sessionId, attribution, relationship`;
const changeRevision = "COALESCE(after_revision, before_revision + 1)";
const entityKind =
  "json_extract(COALESCE(after_entity, before_entity), '$.kind')";
function toEvent(row: EventRow): ChangeEvent {
  const { sessionId, attribution, relationship, ...rest } = row;
  return {
    ...rest,
    id: String(row.id),
    before: row.before === null ? null : JSON.parse(row.before),
    after: row.after === null ? null : JSON.parse(row.after),
    ...(sessionId === null ? {} : { sessionId }),
    ...(attribution === null ? {} : { attribution: JSON.parse(attribution) }),
    ...(relationship === null
      ? {}
      : { relationship: JSON.parse(relationship) }),
  };
}

function changeKind(event: ChangeEvent) {
  return (event.after ?? event.before)?.kind;
}

function summarizeFileChange(
  db: SqliteDatabase,
  file: ChangeEvent,
): FileChangeSummary {
  const revision = file.afterRevision ?? file.beforeRevision! + 1;
  const rows = db
    .prepare<[string, string, number], EventRow>(
      `SELECT ${eventColumns} FROM change_events
      WHERE project_id = ? AND path = ? AND ${changeRevision} = ?
      ORDER BY id`,
    )
    .all(file.projectId, file.path, revision);
  const summary: FileChangeSummary = {
    symbols: [],
    symbolCount: 0,
    addedCalls: 0,
    removedCalls: 0,
    addedImports: 0,
    removedImports: 0,
  };
  const symbols = new Map<string, FileChangeSummary["symbols"][number]>();
  for (const row of rows) {
    const event = toEvent(row);
    const node = event.after ?? event.before;
    if (
      node &&
      "qualifiedName" in node &&
      node.kind !== "file" &&
      !node.name.startsWith("$")
    ) {
      const beforeHash =
        event.before && "contentHash" in event.before
          ? event.before.contentHash
          : undefined;
      const afterHash =
        event.after && "contentHash" in event.after
          ? event.after.contentHash
          : undefined;
      if (beforeHash !== afterHash) {
        symbols.set(node.qualifiedName, {
          name: node.qualifiedName,
          action: event.action,
        });
      }
    }
    const kind = changeKind(event);
    if (kind === "CALLS") {
      if (event.action === "created") summary.addedCalls++;
      if (event.action === "deleted") summary.removedCalls++;
    } else if (kind === "IMPORTS") {
      if (event.action === "created") summary.addedImports++;
      if (event.action === "deleted") summary.removedImports++;
    }
  }
  summary.symbolCount = symbols.size;
  summary.symbols = [...symbols.values()]
    .sort(
      (a, b) =>
        a.name.split(".").length - b.name.split(".").length ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 8);
  return summary;
}

/** Older records saved edge IDs and node history, but did not save call-site coordinates. */
function recoverRelationship(
  db: SqliteDatabase,
  event: ChangeEvent,
): RecordedRelationship | undefined {
  const edge = event.after ?? event.before;
  const revision = event.afterRevision ?? event.beforeRevision;
  if (
    !edge ||
    !("sourceId" in edge) ||
    edge.kind === "CONTAINS" ||
    revision === null
  )
    return;
  const atRevision = db.prepare<
    [string, string, number],
    { entity: string | null }
  >(
    `SELECT after_entity AS entity FROM change_events
      WHERE project_id = ? AND entity_type = 'node' AND entity_id = ?
        AND ${changeRevision} <= ?
      ORDER BY id DESC LIMIT 1`,
  );
  const endpoint = (id: string): GraphNode | undefined => {
    const recorded = atRevision.get(event.projectId, id, revision);
    if (recorded)
      return recorded.entity
        ? (JSON.parse(recorded.entity) as GraphNode)
        : undefined;
    const current = getNode(db, event.projectId, id);
    return current && current.revision <= revision ? current : undefined;
  };
  const source = endpoint(edge.sourceId);
  const target = endpoint(edge.targetId);
  if (!source || !target) return;
  return {
    kind: edge.kind,
    source: {
      id: source.id,
      path: source.path,
      qualifiedName: source.qualifiedName,
    },
    target: {
      id: target.id,
      path: target.path,
      qualifiedName: target.qualifiedName,
    },
    startLine: source.range.startLine,
    endLine: source.range.startLine,
    approximate: true,
    features: [],
  };
}

function describeEvent(db: SqliteDatabase, event: ChangeEvent): ChangeEvent {
  const kind = changeKind(event);
  if (kind === "file")
    return { ...event, fileSummary: summarizeFileChange(db, event) };
  if (
    !event.relationship &&
    event.action !== "modified" &&
    (kind === "CALLS" || kind === "IMPORTS")
  ) {
    const relationship = recoverRelationship(db, event);
    if (relationship) return { ...event, relationship };
  }
  return event;
}

function recordRelationships(
  db: SqliteDatabase,
  projectId: string,
  changes: readonly EntityChange[],
  side: "before" | "after",
) {
  const records = new Map<string, RecordedRelationship>();
  const cache = new Map<string, RecordedRelationship["features"]>();
  const sites = db.prepare<
    [string, string],
    { lines: string | null; ends: string | null }
  >(
    `SELECT source_lines AS lines, source_end_lines AS ends
      FROM edges WHERE project_id = ? AND id = ?`,
  );
  for (const change of changes) {
    if (change.action !== (side === "before" ? "deleted" : "created")) continue;
    const edge = change[side];
    if (!edge || !("sourceId" in edge) || edge.kind === "CONTAINS") continue;
    const source = getNode(db, projectId, edge.sourceId);
    const target = getNode(db, projectId, edge.targetId);
    if (!source || !target) continue;
    const row = sites.get(projectId, edge.id);
    const firstLine = row?.lines
      ? (JSON.parse(row.lines) as number[])[0]
      : undefined;
    const startLine = firstLine ?? source.range.startLine;
    const ends = row?.ends
      ? (JSON.parse(row.ends) as Record<number, number>)
      : {};
    const relationship = {
      kind: edge.kind,
      source: {
        id: source.id,
        path: source.path,
        qualifiedName: source.qualifiedName,
      },
      target: {
        id: target.id,
        path: target.path,
        qualifiedName: target.qualifiedName,
      },
      startLine,
      endLine: ends[startLine] ?? startLine,
      ...(firstLine === undefined ? { approximate: true } : {}),
    };
    records.set(change.entityId, {
      ...relationship,
      features:
        edge.kind === "CALLS"
          ? getCallFeatures(db, projectId, relationship, cache)
          : [],
    });
  }
  return records;
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
      const removed =
        previous > 0
          ? recordRelationships(db, projectId, set.changes, "before")
          : undefined;
      const revision = applyProjectGraph(db, set.graph);
      // The initial index records inventory. Later revisions record additions and removals.
      const added =
        previous > 0
          ? recordRelationships(db, projectId, set.changes, "after")
          : undefined;
      const snapshot = db.prepare(
        "INSERT INTO snapshots (project_id, path, revision, content) VALUES (?, ?, ?, ?)",
      );
      for (const [path, content] of set.sources)
        snapshot.run(projectId, path, revision, content);
      const timestamp = new Date().toISOString();
      const insert = db.prepare(`INSERT INTO change_events
      (project_id, timestamp, entity_type, entity_id, action, path, before_revision, after_revision, before_entity, after_entity, session_id, relationship, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
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
        const relationship =
          removed?.get(change.entityId) ?? added?.get(change.entityId);
        const fileChange = (after ?? before)?.kind === "file";
        const capturedAt = fileChange
          ? set.fileCaptureTimes?.get(change.path)
          : undefined;
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
          relationship ? JSON.stringify(relationship) : null,
          capturedAt ?? null,
        );
        const attribution =
          capturedAt !== undefined
            ? attributeFileChange(
                db,
                projectId,
                change.path,
                capturedAt,
                result.lastInsertRowid,
                after?.kind === "file" ? after.contentHash : null,
              )
            : undefined;
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
          ...(relationship ? { relationship } : {}),
          ...(set.sessionId ? { sessionId: set.sessionId } : {}),
          ...(attribution ? { attribution } : {}),
        };
        return event;
      });
      return { revision, events };
    })
    .immediate();
}

/** Most recent recorded action per relationship, newest first. */
export function listRecentRelationships(
  db: SqliteDatabase,
  projectId: string,
  since: string,
): ChangeEvent[] {
  return db
    .prepare<[string, string], EventRow>(
      `SELECT ${eventColumns} FROM change_events WHERE id IN (
        SELECT MAX(id) FROM change_events
        WHERE project_id = ? AND relationship IS NOT NULL AND timestamp >= ?
        GROUP BY entity_id
      ) ORDER BY timestamp DESC, json_extract(relationship, '$.kind') = 'CALLS' DESC, id DESC LIMIT 200`,
    )
    .all(projectId, since)
    .map(toEvent);
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
  filter: Pick<ChangesQuery, "kind" | "nodeId"> = {},
): import("@mycel/shared").ChangesPage {
  historyLimit(limit);
  const offset =
    cursor === undefined ? Number.MAX_SAFE_INTEGER : parseChangeId(cursor);
  const clause =
    filter.kind === "files"
      ? `AND entity_type = 'node' AND ${entityKind} = 'file' AND ${changeRevision} > 1
      AND (action <> 'modified' OR json_extract(before_entity, '$.contentHash') <> json_extract(after_entity, '$.contentHash'))`
      : filter.kind === "relationships"
        ? `AND entity_type = 'edge' AND action IN ('created', 'deleted')
        AND ${entityKind} IN ('CALLS', 'IMPORTS') AND ${changeRevision} > 1`
        : filter.nodeId
          ? "AND entity_type = 'node' AND entity_id = ?"
          : "";
  const rows = db
    .prepare<(string | number)[], EventRow>(
      `SELECT ${eventColumns} FROM change_events WHERE project_id = ? AND id < ? ${clause} ORDER BY id DESC LIMIT ?`,
    )
    .all(
      projectId,
      offset,
      ...(filter.nodeId && !filter.kind ? [filter.nodeId] : []),
      limit + 1,
    );
  return {
    items: rows.slice(0, limit).map((row) => {
      const event = toEvent(row);
      return filter.kind ? describeEvent(db, event) : event;
    }),
    cursor: rows.length > limit ? String(rows[limit - 1]!.id) : null,
  };
}

export function getChange(
  db: SqliteDatabase,
  projectId: string,
  id: string,
): ChangeEvent | undefined {
  const row = db
    .prepare<[string, number], EventRow>(
      `SELECT ${eventColumns} FROM change_events WHERE project_id = ? AND id = ?`,
    )
    .get(projectId, parseChangeId(id));
  return row ? describeEvent(db, toEvent(row)) : undefined;
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
  const afterRevision = row.afterRevision ?? row.beforeRevision! + 1;
  const beforeRevision = afterRevision - 1;
  const beforeContent = content(beforeRevision);
  const afterContent = content(afterRevision);
  return {
    changeId: id,
    path: row.path,
    beforeContent,
    afterContent,
    beforeRevision: beforeContent === null ? null : beforeRevision,
    afterRevision: afterContent === null ? null : afterRevision,
  };
}

/** Opt-in pruning. Keep current snapshots and every source side of retained events. */
export function pruneHistory(
  db: SqliteDatabase,
  projectId: string,
  beforeId: string,
): void {
  const cutoff = parseChangeId(beforeId);
  db.transaction(() => {
    db.prepare("DELETE FROM change_events WHERE project_id = ? AND id < ?").run(
      projectId,
      cutoff,
    );
    db.prepare(
      `DELETE FROM snapshots AS s WHERE s.project_id = ?
      AND s.revision <> (SELECT MAX(revision) FROM revisions WHERE project_id = s.project_id)
      AND NOT EXISTS (SELECT 1 FROM change_events e WHERE e.project_id = s.project_id AND e.path = s.path
        AND s.revision IN (COALESCE(e.after_revision, e.before_revision + 1), COALESCE(e.after_revision, e.before_revision + 1) - 1))`,
    ).run(projectId);
  }).immediate();
}
