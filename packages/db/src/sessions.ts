import { randomUUID } from "node:crypto";
import type { Project } from "@mycel/shared";
import type { SqliteDatabase } from "./database.js";
import { currentRevision } from "./history.js";
export function startMonitoringSession(
  db: SqliteDatabase,
  project: Project,
): string {
  return db
    .transaction(() => {
      db.prepare(
        "INSERT INTO projects (id, name, root, indexing_settings) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      ).run(
        project.id,
        project.name,
        project.root,
        JSON.stringify(project.indexing),
      );
      const id = randomUUID();
      db.prepare(
        "INSERT INTO sessions (id, project_id, started_at, starting_revision) VALUES (?, ?, ?, ?)",
      ).run(
        id,
        project.id,
        new Date().toISOString(),
        currentRevision(db, project.id),
      );
      return id;
    })
    .immediate();
}
export function endMonitoringSession(db: SqliteDatabase, id: string): void {
  db.prepare(
    "UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL",
  ).run(new Date().toISOString(), id);
}
