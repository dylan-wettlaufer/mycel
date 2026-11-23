import type {
  AgentToolEvent,
  ChangeAttribution,
  ProjectId,
} from "@mycel/shared";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import type { SqliteDatabase } from "./database.js";
import { resolveDatabasePath, resolveExternalDatabasePath } from "./paths.js";

const matchWindowMs = 5_000;

interface ToolRow {
  provider: AgentToolEvent["provider"];
  sessionId: string;
  outcome: AgentToolEvent["phase"];
  expectedHash: string | null;
}

function classifyTools(
  tools: readonly ToolRow[],
  contentHash: string,
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

  const { sessionId, provider } = first;
  if (tools.some((tool) => tool.expectedHash === contentHash))
    return { status: "confirmed", provider, sessionId };
  if (tools.every((tool) => tool.expectedHash === null))
    return { status: "inferred", provider, sessionId };
  return { status: "unknown" };
}

function updateChangeAttribution(
  db: SqliteDatabase,
  changeId: number | bigint,
  contentHash: string,
): ChangeAttribution | undefined {
  const tools = db
    .prepare<[number | bigint], ToolRow>(
      `SELECT provider, session_id AS sessionId, outcome, expected_hash AS expectedHash
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
  contentHash: string,
): ChangeAttribution | undefined {
  const match = db
    .prepare(
      `UPDATE agent_tool_events SET change_id = ?
    WHERE project_id = ? AND path = ? AND change_id IS NULL AND outcome <> 'failed'
      AND started_at BETWEEN ? AND ?
      AND (finished_at IS NULL OR finished_at BETWEEN ? AND started_at + ${matchWindowMs})`,
    )
    .run(
      changeId,
      projectId,
      path,
      capturedAt - matchWindowMs,
      capturedAt,
      capturedAt - 1_000,
    );
  if (match.changes > 0)
    return updateChangeAttribution(db, changeId, contentHash);
}

function saveToolEvent(
  db: SqliteDatabase,
  projectRoot: string,
  event: AgentToolEvent,
): void {
  db.transaction(() => {
    const project = db
      .prepare<[string], { id: string }>(
        "SELECT id FROM projects WHERE root = ?",
      )
      .get(projectRoot);
    if (!project) return;
    const { provider, sessionId, toolUseId, tool, path, timestamp, phase } =
      event;
    const key = [project.id, provider, sessionId, toolUseId] as const;
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
  }).immediate();
}

/** Record metadata through a short-lived connection to an already initialized index. */
export function recordAgentToolEvent(
  projectRoot: string,
  event: AgentToolEvent,
  databasePath?: string,
): void {
  const path =
    databasePath === undefined
      ? resolveDatabasePath(projectRoot)
      : resolveExternalDatabasePath(projectRoot, databasePath);
  if (!existsSync(path)) return;
  const db = new Database(path, { fileMustExist: true, timeout: 1_000 });
  try {
    db.pragma("foreign_keys = ON");
    if (
      db
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE name = 'agent_tool_events' AND type = 'table'",
        )
        .get()
    ) {
      saveToolEvent(db, projectRoot, event);
    }
  } finally {
    db.close();
  }
}
