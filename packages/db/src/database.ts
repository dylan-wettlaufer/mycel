import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { migrateDatabase } from "./migrate.js";
import { resolveDatabasePath, resolveExternalDatabasePath } from "./paths.js";

export type SqliteDatabase = Database.Database;

export interface OpenDatabaseOptions {
  /** Required for disk storage, so locations inside the repository are rejected. */
  projectRoot?: string;
  /** An external absolute path, or :memory: for an isolated temporary database. */
  databasePath?: string;
  busyTimeoutMs?: number;
}

/** Open, configure, and migrate a connection. The caller owns close(). */
export function openDatabase(options: OpenDatabaseOptions): SqliteDatabase {
  const timeout = options.busyTimeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 0x7fffffff) {
    throw new RangeError(
      "busyTimeoutMs must be an integer between 0 and 2147483647",
    );
  }
  let path: string;
  if (options.databasePath === ":memory:") path = ":memory:";
  else {
    if (!options.projectRoot)
      throw new TypeError("projectRoot is required for on-disk storage");
    path =
      options.databasePath === undefined
        ? resolveDatabasePath(options.projectRoot)
        : resolveExternalDatabasePath(
            options.projectRoot,
            options.databasePath,
          );
    mkdirSync(dirname(path), { recursive: true });
  }
  const database = new Database(path, { timeout });
  try {
    database.pragma("foreign_keys = ON");
    if (!database.memory) {
      const journalMode = database.pragma("journal_mode = WAL", {
        simple: true,
      });
      if (journalMode !== "wal")
        throw new Error("Could not enable SQLite WAL mode");
    }
    migrateDatabase(database);
    return database;
  } catch (cause) {
    database.close();
    throw new Error(`Could not initialize Mycel database at ${path}`, {
      cause,
    });
  }
}
