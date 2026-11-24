import { stat } from "node:fs/promises";
import {
  manageProjectHistory,
  openDatabase,
  resolveDatabasePath,
  type SqliteDatabase,
} from "@mycel/db";
import { resolveRepository } from "./repository.js";
import { setManagedHooks } from "./setup-agent-hooks.js";

export async function historyCommand(action: "status" | "clear") {
  const { root } = await resolveRepository();
  const databasePath = resolveDatabasePath(root);
  try {
    await stat(databasePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    console.info(`No history recorded for ${root}`);
    return;
  }
  const database = openDatabase({ projectRoot: root });
  try {
    const usage = manageProjectHistory(database, root, action);
    if (!usage) {
      console.info(`No history recorded for ${root}`);
      return;
    }
    if (action === "clear") {
      try {
        compactDatabase(database);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `History was cleared, but SQLite could not finish reclaiming storage: ${reason}. Run mycel history clear again after closing other Mycel sessions for this repository.`,
          { cause },
        );
      }
      console.info(`Cleared recorded history for ${root}`);
    }
    const databaseBytes =
      Number(database.pragma("page_count", { simple: true })) *
      Number(database.pragma("page_size", { simple: true }));
    console.info(
      `Database: ${databasePath}\nSQLite database bytes: ${databaseBytes}\nRecorded events: ${usage.eventCount}\nUnique source contents: ${usage.uniqueSources}\nStored source bytes (including current files): ${usage.sourceBytes}`,
    );
  } finally {
    database.close();
  }
}

function compactDatabase(database: SqliteDatabase): void {
  database.exec("VACUUM");
  if (database.pragma("wal_checkpoint(TRUNCATE)", { simple: true }) !== 0)
    throw new Error("SQLite could not truncate the write-ahead log");
}

export async function removeProjectData(): Promise<void> {
  const { root } = await resolveRepository();
  const path = resolveDatabasePath(root);
  try {
    await stat(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    await setManagedHooks(root, false);
    console.info(`No local index for ${root}`);
    return;
  }

  const database = openDatabase({ projectRoot: root, busyTimeoutMs: 250 });
  try {
    database.pragma("locking_mode = EXCLUSIVE");
    try {
      database
        .transaction(() => {
          database.prepare("DELETE FROM projects WHERE root = ?").run(root);
        })
        .exclusive();
    } catch (cause) {
      if (
        cause instanceof Error &&
        "code" in cause &&
        cause.code === "SQLITE_BUSY"
      )
        throw new Error(
          "Close any running Mycel dashboards for this repository and retry project remove.",
          { cause },
        );
      throw cause;
    }
    await setManagedHooks(root, false);
    try {
      compactDatabase(database);
    } catch (cause) {
      throw new Error(
        "Project data was removed. Run project remove again to finish reclaiming SQLite storage.",
        { cause },
      );
    }
    console.info(`Removed the local index and history for ${root}`);
  } finally {
    database.close();
  }
}
