import { stat } from "node:fs/promises";
import {
  manageProjectHistory,
  openDatabase,
  resolveDatabasePath,
} from "@mycel/db";
import { resolveRepository } from "./repository.js";

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
        database.exec("VACUUM");
        if (database.pragma("wal_checkpoint(TRUNCATE)", { simple: true }) !== 0)
          throw new Error("SQLite could not truncate the write-ahead log");
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
