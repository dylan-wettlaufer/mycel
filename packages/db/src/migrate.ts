import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { migrations } from "./migrations/index.js";
import type { Migration } from "./migrations/index.js";

interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

/** Migrations are trusted application SQL, never repository/user-provided input. */
export function migrateDatabase(
  database: Database.Database,
  definitions: readonly Migration[] = migrations,
): number {
  const expected = definitions.map((migration, index) => {
    if (
      migration.version !== index + 1 ||
      !migration.name.trim() ||
      !migration.sql.trim()
    ) {
      throw new Error(
        "Migrations must have consecutive versions starting at 1, names, and SQL",
      );
    }
    return {
      ...migration,
      checksum: createHash("sha256").update(migration.sql).digest("hex"),
    };
  });
  if (database.inTransaction)
    throw new Error("Migrations require their own transaction");
  database.pragma("foreign_keys = ON");

  return database
    .transaction(() => {
      database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY CHECK (version > 0),
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT
    `);
      const applied = database
        .prepare<[], AppliedMigration>(
          "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
        )
        .all();
      for (const [index, record] of applied.entries()) {
        const migration = expected[index];
        if (!migration || record.version > expected.length) {
          throw new Error(
            "Database schema is newer than this version of Mycel; upgrade Mycel",
          );
        }
        if (
          record.version !== migration.version ||
          record.name !== migration.name ||
          record.checksum !== migration.checksum
        ) {
          throw new Error(
            `Migration history mismatch at version ${record.version}; applied migrations must not change`,
          );
        }
      }
      const recordMigration = database.prepare(
        "INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)",
      );
      for (const migration of expected.slice(applied.length)) {
        database.exec(migration.sql);
        recordMigration.run(
          migration.version,
          migration.name,
          migration.checksum,
        );
      }
      const violations = database.pragma("foreign_key_check");
      if (!Array.isArray(violations) || violations.length)
        throw new Error("Migration left invalid foreign keys");
      return expected.length;
    })
    .immediate();
}
