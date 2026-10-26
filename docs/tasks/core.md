# `@mycel/core` tasks

The indexing engine. It walks the repository, calls the parser, resolves
cross-file relationships, writes to the database, watches for changes, diffs
graph states into change events, and emits committed events. The server and
CLI talk to it through one engine API. It must not depend on the server or the
frontend.

See [architecture](../ARCHITECTURE.md#change-pipeline-planned).

## Current state

- `discoverSourceFiles` applies hard directory exclusions, root/nested
  `.gitignore` rules, configured globs, and the parser's supported extensions.
- `indexRepository` captures and parses source, builds deterministic file and
  symbol nodes/containment, then replaces one project's graph transactionally
  through db. It returns committed revision/counts and elapsed time.
- `createGraphQueries` exposes project-scoped database queries through a core
  facade for server consumers.
- `openIndexedProject` owns the database and initial scan, exposes queries after
  the commit, and closes storage on shutdown or startup failure.
- Import/call resolution, engine lifecycle, and live updates
  remain planned. See [usage and boundaries](../../packages/core/README.md).

## Tasks

### Phase 2: engine API and full index

- [ ] Define `createEngine({ project, databasePath })` returning an object
      with query methods (delegating to db), `start()`, `stop()`, and an event
      subscription such as `onEvent(listener)`.
- [x] Add a standalone full-index entry point and discovery API.
- [x] Walk the repository for supported `.ts` and `.tsx` files,
      skipping `node_modules`, `dist`, `build`, `.git`, and coverage
      directories, and honoring `.gitignore`.
- [x] Parse each file and store file/symbol nodes, containment edges, and parser
      diagnostics through db. Resolved import/call edges are separate below.
- [x] Generate deterministic node ids from project, path, kind, and qualified
      name, with an ordinal for duplicates (see the identity rules in the
      architecture document).
- [x] Compute exact source content hashes and commit a project snapshot plus
      its new revision atomically; remove stale/deleted/excluded file records.
- [ ] Extend discovery when `.mts`/`.cts` support is added to the parser and
      shared extension contract. Those extensions are currently excluded.
- [ ] Resolve relative imports to files, including extension and `index`
      resolution.
- [ ] Decide how far to honor `tsconfig` `paths`, `baseUrl`, and workspace
      packages in the first version (open decision 7).
- [ ] Resolve calls to imported or same-file symbols. Leave everything else
      unresolved and record a diagnostic where useful.
- [ ] Report progress (files indexed of total) for `/api/health`.

### Phase 3: live updates

- [ ] Add Chokidar to watch the same file set as the indexer.
- [ ] Debounce events per path and coalesce bursts of writes.
- [ ] Skip files whose content hash has not changed.
- [ ] Reparse only changed files and replace their nodes and edges.
- [ ] Re-resolve edges in files that import the changed file when its exports
      change.
- [ ] Handle deletion (remove nodes and incoming edges) and rename (open
      decision 5: pair unlink and add by content hash or treat as delete plus
      create).
- [ ] On parse failure, keep the last valid graph for that file and surface a
      diagnostic.
- [ ] Time each stage (detection, parse, resolve, database write) and expose
      the measurements.

### Phase 4: change detection and events

- [ ] Diff the previous and new graph for a file into created, modified, and
      deleted node and edge changes.
- [ ] Commit the change set, snapshots, and events in one db transaction.
- [ ] Emit events to subscribers only after the commit succeeds.
- [ ] Start a monitoring session on launch that records the starting revision.
- [ ] On startup, reconcile the database with the working tree. Files changed
      while Mycel was not running should produce events.

## Tests

- [x] Index fixture repositories and assert structural nodes, containment,
      hashes, ranges, diagnostics, persistence, and project isolation.
- [x] Verify nested ignore rules against Git and cover custom exclusions,
      unsupported files, generated directories, and symlinks.
- [x] Failed scans/graph writes preserve the previous graph and revision.
- [ ] Watcher integration tests: create, edit, delete, and rename files in a
      temporary directory and assert the resulting events.
- [ ] Rapid successive writes produce one consistent final state.
- [ ] A failed database write emits no event.
- [ ] Restarting the engine does not duplicate events.

## Done when

- The engine indexes a small repository, keeps it current while files change,
  and emits committed events in order.
- Unresolved references stay unresolved instead of creating guessed edges.
- The package has no dependency on `server` or `web`.
