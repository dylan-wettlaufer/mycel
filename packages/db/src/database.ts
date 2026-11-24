import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
} from "node:fs";
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

function isFileError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function setPrivateMode(path: string, directory: boolean): void {
  const flags = directory ? constants.O_DIRECTORY : constants.O_NONBLOCK;
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | flags,
  );
  try {
    const stat = fstatSync(descriptor);
    if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
      throw new Error(`Unexpected database storage entry: ${path}`);
    const mode = directory ? 0o700 : 0o600;
    if ((stat.mode & 0o7777) !== mode) fchmodSync(descriptor, mode);
  } finally {
    closeSync(descriptor);
  }
}

/** Keep source history private before SQLite can open a journal or WAL. */
export function secureDatabaseFiles(
  path: string,
  managed: boolean,
  create: boolean,
): void {
  const directory = dirname(path);
  const supportsModes = process.platform !== "win32";
  if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (managed && supportsModes) {
    // Keep changes to the application namespace and its projects directory.
    setPrivateMode(dirname(directory), true);
    setPrivateMode(directory, true);
  }
  if (create) {
    try {
      closeSync(openSync(path, "wx", 0o600));
    } catch (error) {
      if (!isFileError(error, "EEXIST")) throw error;
    }
  }
  for (const file of [path, path + "-wal", path + "-shm", path + "-journal"]) {
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) continue;
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error(`Expected a regular, unshared database file: ${file}`);
    if (supportsModes && (stat.mode & 0o7777) !== 0o600) {
      try {
        setPrivateMode(file, false);
      } catch (error) {
        // A concurrent SQLite connection may remove a transient sidecar.
        if (file === path || !isFileError(error, "ENOENT")) throw error;
      }
    }
  }
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
    secureDatabaseFiles(path, options.databasePath === undefined, true);
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
