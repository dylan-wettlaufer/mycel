# `@mycel/db` tasks

SQLite persistence for projects, the graph, diagnostics, source snapshots, and
change history, using `better-sqlite3`. Owns the schema, migrations,
transactional writes, and read queries. It knows nothing about parsing or HTTP.

See [architecture](../ARCHITECTURE.md#data-model).

## Current state

- `openDatabase` configures connections and applies transactional migrations.
- Initial strict schema for projects, nodes, edges, diagnostics, revisions,
  and migration history, with integrity constraints and lookup indexes.
- Canonical per-repository paths in the platform's per-user Mycel data directory;
  explicit overrides are checked to stay outside the repository.
- Tests use in-memory databases and temporary external storage. See
  [package usage and schema](../../packages/db/README.md).
- `replaceProjectGraph` writes a complete current project graph and its next
  revision in one transaction for full-repository indexing.
- Project-scoped node lookup, ranked file/symbol search, bounded neighborhoods,
  callers, and dependencies use the shared graph/query contracts.

## Tasks

### Phase 2: setup and schema

- [x] Add `better-sqlite3` and its types, and allow its build script in
      `pnpm.onlyBuiltDependencies`.
- [x] Implement `resolveDatabasePath(projectRoot)` that returns a per-project file
      outside the repository.
- [x] Open connections with WAL mode, foreign keys on, and a busy timeout.
- [x] Write a migration runner with a `schema_migrations` table and ordered
      files in `src/migrations/`.
- [x] Create tables: `projects`, `nodes`, `edges`, `diagnostics`, `revisions`.
- [x] Add indexes for lookup by id, path, qualified name, and edge source and
      target.
- [x] Add full-text search (FTS5) over node names and paths, or a simpler
      `LIKE` search if FTS5 is not needed yet.

### Phase 2: queries

- [x] `replaceProjectGraph(...)`: upsert project metadata and replace its nodes,
      edges, and diagnostics with one revision, preserving other projects and
      rolling back on failure. Reject cross-project records and internal paths.
- [x] `getNode(id)`.
- [x] `searchSymbols(query, limit)`, ranking exact and prefix matches first.
- [x] `getNeighborhood(id, depth, limit)`: a bounded subgraph with a truncation
      flag.
- [x] `getCallers(id)` and `getDependencies(id)`.
- [ ] `getStats()`: file, symbol, and edge counts for the dashboard.
- [ ] `replaceFileGraph(path, nodes, edges, diagnostics)` inside one
      transaction.

### Phase 4: history

- [x] Create tables: `snapshots` (path, revision, content), `change_events`
      (monotonic integer id, timestamp, entity, action, before and after
      revision, attribution), and `sessions`.
- [x] `commitChangeSet(...)`: one transaction that writes graph changes,
      snapshots, events, and the new revision, and returns the inserted events.
- [x] `listChanges(cursor, limit)` for pagination.
- [x] `getEventsAfter(id)` for SSE replay.
- [x] `getDiff(changeId)` returning before and after content from snapshots.
- [x] Support explicit pruning of old snapshots and events
      without breaking diffs that are still reachable.

### Phase 7: robustness

- [ ] Recover from a corrupt or locked database with a clear error message and
      an option to rebuild from source.
- [x] Handle a schema version newer than the running code.

## Tests

- [x] Migrations apply cleanly to an empty database and are idempotent.
- [x] Failed migration batches and low-level graph transactions leave no partial
      writes; modified/newer migration histories are rejected.
- [x] Constraints, project isolation, cascading cleanup, WAL persistence, and
      external storage paths (including symlinks).
- [x] Queries against an in-memory database seeded with a fixture graph.
- [x] A failing write inside `commitChangeSet` leaves no partial state.
- [x] Event ids are strictly increasing across restarts.

## Done when

- Core can index a fixture repository into the database and read it back
  through these queries.
- All writes for one change set happen in a single transaction.
- The database file is never created inside the target repository.

The schema/connection, full-project writes, and public graph queries are
complete. Stats and per-file graph replacement remain
unchecked above.
