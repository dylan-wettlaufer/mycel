# @mycel/db

SQLite connection setup and versioned graph-schema migrations. This package
depends on `better-sqlite3` and shared contracts, and does not import the parser,
indexing engine, HTTP server, or frontend.

## Open a database

```ts
import { openDatabase } from "@mycel/db";

const database = openDatabase({
  projectRoot: "/absolute/path/to/repository",
});

try {
  const tables = database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
    .all();
  console.log(tables);
} finally {
  database.close();
}
```

Opening creates missing parent directories, enables foreign keys, sets a busy
timeout (default 5,000 ms), enables WAL for disk databases, and applies pending
migrations. Initialization failures close the connection. The caller owns the
returned synchronous `better-sqlite3` connection and must close it on shutdown.

Pass an external absolute `databasePath` to override the default location and
`busyTimeoutMs` to override the timeout. Disk storage requires `projectRoot` so
paths inside the repository can be rejected before directories/files are
created. The caller supplies the actual repository root resolved by the CLI.
Existing files and ancestors are canonicalized through symlinks. Relative paths,
dangling symlinks, and internal destinations fail explicitly.

Tests and temporary consumers can use
`openDatabase({ databasePath: ":memory:" })` without a repository root.
In-memory databases use SQLite's memory journal instead of WAL.

## Default location

`resolveDatabasePath(projectRoot, dataDirectory?)` computes a path without
creating files. It hashes the canonical repository root with SHA-256 and returns
`<data directory>/projects/<hash>.sqlite`. Root symlinks share the same location.
The hash selects storage; it does not implement graph node/project IDs.

Default data directories:

| Platform | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/Mycel` |
| Linux | `$XDG_DATA_HOME/mycel`, or `~/.local/share/mycel` |
| Windows | `%LOCALAPPDATA%\Mycel`, or `~\AppData\Local\Mycel` |

Relative environment-directory overrides are ignored. Custom data directories
must be absolute and outside the repository. If the repository contains the
default data directory (for example, a repository rooted at the home directory),
opening fails and the caller must choose an external location. CLI flags for
overriding storage are separate integration work.

## Schema version 1

All tables use SQLite strict typing:

- `projects`: opaque string ID, name, unique canonical root, and JSON indexing
  settings. Settings must be an object with extension/exclusion arrays and a
  boolean `respectGitignore` flag; core will validate the array contents.
- `revisions`: project-scoped safe-integer revision and creation time. Inserts
  must increase per project; records cannot be updated or individually deleted.
  Revision zero denotes an empty graph; graph records require positive revisions.
- `nodes`: project-scoped string ID, graph kind, names, relative path, six source
  range columns, content hash, and last-written revision.
- `edges`: project-scoped string ID, resolved source/target IDs, relation kind,
  and last-written revision. Composite foreign keys prevent cross-project or
  missing endpoints. Deleting a node cascades its incoming/outgoing edges.
- `diagnostics`: internal row ID, project/path, source range, severity, source,
  code, message, and revision. A file node is not required, so syntax failures
  can be recorded even when no usable graph structure exists.
- `schema_migrations`: database-wide version, name, SQL checksum, and apply time.

Project deletion cascades its graph, diagnostics, and revisions. Referenced
revisions must exist in the same project. Source offsets are UTF-16 code units,
end-exclusive, with one-based lines/columns. Checks reject reversed ranges,
invalid kinds, invalid hash format, and unsafe revision values. Missing-token
diagnostics may have zero-width ranges.

Primary keys support scoped ID lookup. Secondary indexes cover node paths,
qualified names, case-insensitive names, edge sources/targets, diagnostic paths,
and revision foreign keys. Search/query implementations and any decision to add
FTS5 remain future work. Path normalization, semantic edge validation, and
source/hash generation remain core responsibilities.

## Migrations and writes

Ordered migrations live in `src/migrations/` as TypeScript modules containing
SQL. `tsc` includes them in `dist/`, so runtime execution needs no source-tree
paths or separate asset-copy step. Add a new consecutive migration for schema
changes; never edit an applied migration.

`migrateDatabase(database)` verifies the recorded history and runs every pending
migration plus its history inserts in one immediate transaction. Failure rolls
back the entire pending batch, including DDL. Reopening an up-to-date database
preserves its data and migration timestamps. Unknown newer schema versions,
changed names/checksums, history gaps, nested migration transactions, and
foreign-key violations are rejected.

An optional migration-definition list is available for controlled application
extensions and tests. Definitions are trusted application SQL, never SQL read
from an indexed repository or HTTP request. They must not contain transaction
control statements or change connection pragmas.

The native connection exposes synchronous `transaction()` for future graph
writers. Allocate the next project revision and write nodes, edges, and
diagnostics in the same transaction. Application write/query methods,
snapshots, events, and history retention are separate milestones.

## Verify

```sh
pnpm --filter @mycel/db test
pnpm typecheck
pnpm lint
pnpm test
```

Tests cover fresh/idempotent migrations, batch/graph rollback, drift/newer-schema
detection, strict constraints, foreign keys, cascading deletion, revisions,
WAL persistence, and external-path/symlink handling. Platform path conventions
are checked as pure functions; native installation has been verified locally on
macOS with Node 26.9.0. Linux/Windows native verification is still pending.
