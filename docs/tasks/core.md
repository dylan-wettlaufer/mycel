# `@mycel/core` tasks

The indexing engine. It walks the repository, calls the parser, resolves
cross-file relationships, writes to the database, watches for changes, diffs
graph states into change events, and emits committed events. The server and
CLI talk to it through one engine API. It must not depend on the server or the
frontend.

See [architecture](../ARCHITECTURE.md#change-pipeline).

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
- Live updates watch source files, skip unchanged hashes, preserve valid graphs
  through parser failures, and expose per-stage commit timings. Core resolves
  imports and calls from cached parse facts, rebuilds semantic enrichment,
  and emits structural change events after committing. See
  [usage and boundaries](../../packages/core/README.md).

## Tasks

### V0 semantic mappings and queries

- [ ] Reconcile feature identities independently of implementation paths and
      invalidate stale source mappings after edits.
- [ ] Validate agent-proposed references and relationships against the index.
- [ ] Expose scoped architecture and feature queries with source evidence and
      committed revisions. Cover refreshes from semantic-only commits.

### Phase 2: engine API and full index

- [ ] Define `createEngine({ project, databasePath })` returning an object
      with query methods (delegating to db), `start()`, `stop()`, and an event
      subscription such as `onEvent(listener)`.
- [x] Add a standalone full-index entry point and discovery API.
- [x] Walk the repository for supported `.ts`, `.tsx`, and `.py` files,
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
- [x] Resolve relative imports to files, including extension and `index`
      resolution.
- [x] Resolve supported `tsconfig` `paths`, `baseUrl`, and workspace-package
      imports. See [resolution scope](../../packages/core/README.md#relationship-resolution).
- [x] Resolve calls to imported or same-file symbols. Leave everything else
      unresolved and record a diagnostic where useful.
- [ ] Report progress (files indexed of total) for `/api/health`.

### V0 architecture map

- [x] Assign indexed files to declared parts and component responsibilities,
      with a workspace or folder fallback.
- [x] Aggregate resolved cross-part imports and calls with exact counts and Git
      highlights. Bound retained evidence by connection and cap the source
      locations returned for each link.

### Phase 3: live updates

- [x] Add Chokidar to watch the same file set as the indexer.
- [x] Debounce events per path and coalesce bursts of writes.
- [x] Skip files whose content hash has not changed.
- [x] Reparse only changed files and replace their nodes and edges.
- [x] Re-resolve edges in files that import the changed file when its exports
      change. Resolution currently recomputes from all cached facts.
- [x] Handle deletion and remove incoming edges. Record file renames as a
      delete and a create.
- [x] Apply graph changes and revision allocation in one SQLite transaction.
- [x] On parse failure, keep the last valid graph for that file and surface a
      diagnostic.
- [x] Time each stage (queue/debounce, capture, parse, resolve, database write) and expose
      the measurements.

### Phase 4: change detection and events

- [x] Diff the previous and new graph for a file into created, modified, and
      deleted node and edge changes.
- [x] Commit the change set, snapshots, and events in one db transaction.
- [x] Emit events to subscribers only after the commit succeeds.
- [x] Start a monitoring session on launch that records the starting revision.
- [x] On startup, reconcile the database with the working tree. Files changed
      while Mycel was not running should produce events.

## Tests

- [x] Index fixture repositories and assert structural nodes, containment,
      hashes, ranges, diagnostics, persistence, and project isolation.
- [x] Verify nested ignore rules against Git and cover custom exclusions,
      unsupported files, generated directories, and symlinks.
- [x] Failed scans/graph writes preserve the previous graph and revision.
- [x] Extract and index a checked-in two-file import/call fixture without seeded edges.
- [x] Exercise evidence caps with duplicate links, unsorted input, and changes
      backed by links omitted from the response.
- [x] Pass acceptance tests for `main.ts → utils.ts` imports and `save → validate` calls.
- [x] Watcher integration tests: create, edit, delete, and rename files in a
      temporary directory and assert the resulting events.
- [x] Rapid successive writes produce one consistent final state.
- [x] A failed database write emits no event.
- [x] Restarting the engine does not duplicate events.

## Done when

- The engine indexes a small repository, keeps it current while files change,
  and emits committed events in order.
- Unresolved references stay unresolved instead of creating guessed edges.
- The package has no dependency on `server` or `web`.
