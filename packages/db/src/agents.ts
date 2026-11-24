import type {
  AgentProvider,
  AgentToolEvent,
  ChangeAttribution,
  ProjectId,
} from "@mycel/shared";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { secureDatabaseFiles, type SqliteDatabase } from "./database.js";
import { resolveDatabasePath, resolveExternalDatabasePath } from "./paths.js";

const matchWindowMs = 5_000;
const captureAfterHookMs = 1_000;

export function getAgentHookActivity(
  db: SqliteDatabase,
  projectId: ProjectId,
): ReadonlyMap<AgentProvider, number> {
  const rows = db
    .prepare<[ProjectId], { provider: AgentProvider; receivedAt: number }>(
      `SELECT provider, MAX(COALESCE(finished_at, started_at)) AS receivedAt
      FROM agent_tool_events WHERE project_id = ? GROUP BY provider`,
    )
    .all(projectId);
  return new Map(
    rows.map(({ provider, receivedAt }) => [provider, receivedAt]),
  );
}

interface ToolRow {
  provider: AgentToolEvent["provider"];
  sessionId: string;
  outcome: "started" | "succeeded";
  expectedHash: string | null;
  isObservation: number;
  observedHash: string | null;
}

function classifyTools(
  tools: readonly ToolRow[],
  contentHash: string | null,
): ChangeAttribution | undefined {
  const first = tools[0];
  if (!first) return;
  if (
    tools.some(
      (tool) =>
        tool.outcome === "started" ||
        tool.provider !== first.provider ||
        tool.sessionId !== first.sessionId,
    )
  )
    return { status: "unknown" };
  if (
    tools.every(
      (tool) => tool.isObservation && tool.observedHash !== contentHash,
    )
  )
    return { status: "unknown" };

  const { sessionId, provider } = first;
  if (
    contentHash !== null &&
    tools.some((tool) => tool.expectedHash === contentHash)
  )
    return { status: "confirmed", provider, sessionId };
  if (tools.every((tool) => tool.expectedHash === null))
    return { status: "inferred", provider, sessionId };
  return { status: "unknown" };
}

function updateChangeAttribution(
  db: SqliteDatabase,
  changeId: number | bigint,
  contentHash: string | null,
): ChangeAttribution | undefined {
  const tools = db
    .prepare<[number | bigint], ToolRow>(
      `SELECT provider, session_id AS sessionId, outcome, expected_hash AS expectedHash,
        is_observation AS isObservation, observed_hash AS observedHash
    FROM agent_tool_events WHERE change_id = ? AND outcome <> 'failed'
      AND (finished_at IS NULL OR finished_at <= started_at + ${matchWindowMs})`,
    )
    .all(changeId);
  const attribution = classifyTools(tools, contentHash);
  db.prepare("UPDATE change_events SET attribution = ? WHERE id = ?").run(
    attribution ? JSON.stringify(attribution) : null,
    changeId,
  );
  return attribution;
}

/** Associate each tool once, with the first eligible captured file change. */
export function attributeFileChange(
  db: SqliteDatabase,
  projectId: ProjectId,
  path: string,
  capturedAt: number,
  changeId: number | bigint,
  contentHash: string | null,
): ChangeAttribution | undefined {
  const match = db
    .prepare(
      `WITH previous_capture AS (
        SELECT MAX(captured_at) AS timestamp FROM change_events
        WHERE project_id = @projectId AND path = @path
          AND captured_at IS NOT NULL AND id < @changeId
      )
    UPDATE agent_tool_events SET change_id = @changeId
    WHERE project_id = @projectId AND path = @path AND change_id IS NULL
      AND started_at BETWEEN @capturedAt - ${matchWindowMs} AND @capturedAt + ${matchWindowMs}
      AND outcome <> 'failed' AND (
        (is_observation = 0 AND @hash IS NOT NULL
          AND started_at BETWEEN @capturedAt - ${matchWindowMs} AND @capturedAt
          AND (finished_at IS NULL OR finished_at BETWEEN @capturedAt - ${captureAfterHookMs} AND started_at + ${matchWindowMs}))
        OR (is_observation = 1 AND started_at >= @capturedAt - ${captureAfterHookMs} AND (
          observed_hash IS @hash
          OR (@hash IS NOT NULL AND observed_hash IS NOT NULL
            AND started_at <= @capturedAt AND started_at > COALESCE((SELECT timestamp FROM previous_capture), 0))
        ))
      )`,
    )
    .run({ changeId, projectId, path, capturedAt, hash: contentHash });
  if (match.changes > 0)
    return updateChangeAttribution(db, changeId, contentHash);
}

function saveObservation(
  db: SqliteDatabase,
  projectId: ProjectId,
  event: Extract<AgentToolEvent, { phase: "observed" }>,
): void {
  const {
    provider,
    sessionId,
    toolUseId,
    tool,
    path,
    timestamp,
    observedHash,
    expectedHash,
  } = event;
  const latest = db
    .prepare<
      [ProjectId, string, number, number],
      { id: number; hash: string | null }
    >(
      `SELECT id, json_extract(after_entity, '$.contentHash') AS hash FROM change_events
    WHERE project_id = ? AND path = ? AND captured_at BETWEEN ? AND ?
    ORDER BY captured_at DESC, id DESC LIMIT 1`,
    )
    .get(
      projectId,
      path,
      timestamp - matchWindowMs,
      timestamp + captureAfterHookMs,
    );
  const changeId = latest?.hash === observedHash ? latest.id : null;
  const inserted = db
    .prepare(
      `INSERT INTO agent_tool_events
      (project_id, provider, session_id, tool_use_id, tool, path, started_at, finished_at,
       outcome, expected_hash, change_id, is_observation, observed_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, 1, ?) ON CONFLICT DO NOTHING`,
    )
    .run(
      projectId,
      provider,
      sessionId,
      toolUseId,
      tool,
      path,
      timestamp,
      timestamp,
      expectedHash ?? null,
      changeId,
      observedHash,
    );
  if (inserted.changes && changeId !== null)
    updateChangeAttribution(db, changeId, observedHash);
}

function saveToolEvent(
  db: SqliteDatabase,
  projectId: ProjectId,
  event: AgentToolEvent,
): void {
  if (event.phase === "observed") {
    saveObservation(db, projectId, event);
    return;
  }
  const { provider, sessionId, toolUseId, tool, path, timestamp, phase } =
    event;
  const key = [projectId, provider, sessionId, toolUseId] as const;
  if (phase === "started") {
    db.prepare(
      `INSERT INTO agent_tool_events
          (project_id, provider, session_id, tool_use_id, tool, path, started_at, outcome)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'started') ON CONFLICT DO NOTHING`,
    ).run(...key, tool, path, timestamp);
    return;
  }

  const matched = db.prepare<
    [
      number,
      AgentToolEvent["phase"],
      string | null,
      ...typeof key,
      string,
      string,
      number,
    ],
    { changeId: number | null }
  >(
    `UPDATE agent_tool_events SET finished_at = ?, outcome = ?, expected_hash = ?
       WHERE project_id = ? AND provider = ? AND session_id = ?
         AND tool_use_id = ? AND tool = ? AND path = ?
         AND outcome = 'started' AND started_at <= ?
       RETURNING change_id AS changeId`,
  );
  const row = matched.get(
    timestamp,
    phase,
    event.expectedHash ?? null,
    ...key,
    tool,
    path,
    timestamp,
  );
  if (row?.changeId == null) return;
  const content = db
    .prepare<[number], { contentHash: string }>(
      "SELECT json_extract(after_entity, '$.contentHash') AS contentHash FROM change_events WHERE id = ?",
    )
    .get(row.changeId);
  if (content) updateChangeAttribution(db, row.changeId, content.contentHash);
}

/** Record metadata through a short-lived connection to an already initialized index. */
export function recordAgentToolEvents(
  projectRoot: string,
  events: readonly AgentToolEvent[],
  databasePath?: string,
): void {
  if (events.length === 0) return;
  const path =
    databasePath === undefined
      ? resolveDatabasePath(projectRoot)
      : resolveExternalDatabasePath(projectRoot, databasePath);
  if (!existsSync(path)) return;
  secureDatabaseFiles(path, databasePath === undefined, false);
  const db = new Database(path, { fileMustExist: true, timeout: 1_000 });
  try {
    db.pragma("foreign_keys = ON");
    if (
      db
        .prepare(
          "SELECT 1 FROM pragma_table_info('agent_tool_events') WHERE name = 'is_observation'",
        )
        .get()
    ) {
      db.transaction(() => {
        const project = db
          .prepare<[string], { id: string }>(
            "SELECT id FROM projects WHERE root = ?",
          )
          .get(projectRoot);
        if (!project) return;
        for (const event of events) saveToolEvent(db, project.id, event);
      }).immediate();
    }
  } finally {
    db.close();
  }
}
