# `@mycel/server` tasks

The Hono HTTP layer. It serves the built dashboard, exposes read-only query
routes over the core engine, and streams committed events over SSE. It reads
data only through `@mycel/core`.

See [architecture](../ARCHITECTURE.md#http-api).

## Current state

- `createApp(options)` in `src/app.ts` and `startServer(port, options)` in
  `src/server.ts`. The server binds to `127.0.0.1`.
- `GET /api/health` reports liveness and includes `sourceWarnings` when files
  are unreadable.
- `GET /api/project` returns the repository selected by the CLI, or 503.
- Unknown `/api` routes return 404. Static files come from `apps/web/dist`, and
  HTML navigation falls back to `index.html`.
- `src/start.ts` is a fixed-port (3000) development entry targeting the Mycel
  workspace.
- Graph routes accept a project-scoped core `GraphQueries` facade through
  `AppOptions.graph`; search, node details, and neighborhoods use shared response
  contracts. See [server usage](../../packages/server/README.md).
- Tests in `test/server.test.mjs` and `test/graph.test.mjs`.

## Tasks

### Phase 2: graph routes

- [x] Accept the core query facade in `AppOptions` and move routes into
      `src/routes/` as the API grows.
- [x] `GET /api/graph/search?q=` with a result limit.
- [x] `GET /api/graph/nodes/:id`, returning 404 for unknown ids.
- [x] `GET /api/graph/nodes/:id/neighborhood` with bounded `depth` and
      `limit` parameters.
- [x] `GET /api/files/content?path=`: validate the repository-relative path and
      return captured source from the current indexed project.
- [x] Validate graph query parameters and return 400 with a JSON error body for bad
      input.
- [ ] Extend `/api/health` with index and database status from the engine.
- [x] Wire initial indexing and graph queries into CLI/dev startup; close storage
      on shutdown and failed startup through `startIndexedServer`.
- [x] Serve project-scoped counts from `GET /api/graph/stats` for the
      committed revision.

### V0 architecture map

- [x] Serve `GET /api/architecture` with Git windows, an optional component
      scope, and a per-connection evidence limit.
- [x] Return exact link counts, truncated evidence, and source locations scoped
      to the indexed map revision. Return an error when a requested component
      breakdown is unavailable.
- [x] Notify the dashboard via SSE when index, Git, or architecture file
      changes affect the map.

### Phase 4: history and events

- [x] `GET /api/changes` with cursor pagination.
- [x] `GET /api/changes/:id/diff`.
- [x] `GET /api/events` as an SSE stream using Hono's streaming helpers. Send
      each committed event with its id.
- [x] Support `Last-Event-ID` so reconnecting clients receive missed events
      from the database.
- [x] Send periodic heartbeats and clean up subscribers when clients
      disconnect.

### Security

- [x] Require a loopback `Host` on the listener port to guard against DNS
      rebinding.
- [x] Require any supplied browser `Origin` to match the local dashboard.
      The Vite proxy validates the original request before forwarding it.
- [x] Keep the inspection APIs read-only.

### Phase 7: robustness

- [x] Report an occupied development port and release the project database
      on failed startup.
- [x] Abort active SSE streams during shutdown before waiting for HTTP
      connections to close.

## Tests

- [x] Graph routes with an in-memory fixture database, validation, errors,
      project isolation, and loopback HTTP. File/history routes remain below.
- [ ] Path traversal (`..`, absolute paths, symlinks out of the root) is
      rejected by `/api/files/content`.
- [x] SSE delivers events in order and replays after `Last-Event-ID`.
- [x] Requests with a foreign `Host` or `Origin` are rejected.
- [x] Indexed server startup and shutdown tests cover an occupied port, storage
      cleanup, and active SSE streams.

## Done when

- V0 architecture and drill-down queries expose source evidence and revision
  through shared types.
- The browser never sees data that has not been committed to the database.
