# `@mycel/db` tasks

SQLite persistence for projects, the graph, diagnostics, source snapshots, and
change history, using `better-sqlite3`. Owns the schema, migrations,
transactional writes, and read queries. It knows nothing about parsing or HTTP.

See [architecture](../ARCHITECTURE.md#data-model-planned).

## Current state

- Empty scaffold (`src/index.ts`).

## Tasks

### Phase 2: setup and schema

- [ ] Add `better-sqlite3` and its types, and allow its build script in
      `pnpm.onlyBuiltDependencies`.
- [ ] Decide the data directory (open decision 3). Implement
      `resolveDatabasePath(projectRoot)` that returns a per-project file
      outside the repository.
- [ ] Open connections with WAL mode, foreign keys on, and a busy timeout.
- [ ] Write a migration runner with a `schema_migrations` table and ordered
      files in `src/migrations/`.
- [ ] Create tables: `projects`, `nodes`, `edges`, `diagnostics`, `revisions`.
- [ ] Add indexes for lookup by id, path, qualified name, and edge source and
      target.
- [ ] Add full-text search (FTS5) over node names and paths, or a simpler
      `LIKE` search if FTS5 is not needed yet.

### Phase 2: queries

- [ ] `getNode(id)`.
- [ ] `searchSymbols(query, limit)`, ranking exact and prefix matches first.
- [ ] `getNeighborhood(id, depth, limit)`: a bounded subgraph with a truncation
      flag.
- [ ] `getCallers(id)` and `getDependencies(id)`.
- [ ] `getStats()`: file, symbol, and edge counts for the dashboard.
- [ ] `replaceFileGraph(path, nodes, edges, diagnostics)` inside one
      transaction.

### Phase 4: history

- [ ] Create tables: `snapshots` (path, revision, content), `change_events`
      (monotonic integer id, timestamp, entity, action, before and after
      revision, attribution), and `sessions`.
- [ ] `commitChangeSet(...)`: one transaction that writes graph changes,
      snapshots, events, and the new revision, and returns the inserted events.
- [ ] `listChanges(cursor, limit)` for pagination.
- [ ] `getEventsAfter(id)` for SSE replay.
- [ ] `getDiff(changeId)` returning before and after content from snapshots.
- [ ] Retention policy (open decision 4): prune old snapshots and events
      without breaking diffs that are still reachable.

### Phase 7: robustness

- [ ] Recover from a corrupt or locked database with a clear error message and
      an option to rebuild from source.
- [ ] Handle a schema version newer than the running code.

## Tests

- [ ] Migrations apply cleanly to an empty database and are idempotent.
- [ ] Queries against an in-memory database seeded with a fixture graph.
- [ ] A failing write inside `commitChangeSet` leaves no partial state.
- [ ] Event ids are strictly increasing across restarts.

## Done when

- Core can index a fixture repository into the database and read it back
  through these queries.
- All writes for one change set happen in a single transaction.
- The database file is never created inside the target repository.
