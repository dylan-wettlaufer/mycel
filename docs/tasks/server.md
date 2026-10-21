# `@mycel/server` tasks

The Hono HTTP layer. It serves the built dashboard, exposes read-only query
routes over the core engine, and streams committed events over SSE. It reads
data only through `@mycel/core`.

See [architecture](../ARCHITECTURE.md#http-api).

## Current state

- `createApp(options)` in `src/app.ts` and `startServer(port, options)` in
  `src/server.ts`. The server binds to `127.0.0.1`.
- `GET /api/health` returns `{ status: "ok" }` (liveness only).
- `GET /api/project` returns the repository selected by the CLI, or 503.
- Unknown `/api` routes return 404. Static files come from `apps/web/dist`, and
  HTML navigation falls back to `index.html`.
- `src/start.ts` is a fixed-port (3000) development entry targeting the Mycel
  workspace.
- Tests in `test/server.test.mjs`.

## Tasks

### Phase 2: graph routes

- [ ] Accept the core engine in `AppOptions` and move routes into
      `src/routes/` as the API grows.
- [ ] `GET /api/graph/search?q=` with a result limit.
- [ ] `GET /api/graph/nodes/:id`, returning 404 for unknown ids.
- [ ] `GET /api/graph/nodes/:id/neighborhood` with bounded `depth` and
      `limit` parameters.
- [ ] `GET /api/files/content?path=`: resolve the path with `realpath`, reject
      anything outside the project root (including through symlinks), and
      return 404 for missing files.
- [ ] Validate query parameters and return 400 with a JSON error body for bad
      input.
- [ ] Extend `/api/health` with index and database status from the engine.
- [ ] Add a `GET /api/stats` route for the dashboard cards, or include the
      counts in `/api/project`.

### Phase 4: history and events

- [ ] `GET /api/changes` with cursor pagination.
- [ ] `GET /api/changes/:id/diff`.
- [ ] `GET /api/events` as an SSE stream using Hono's streaming helpers. Send
      each committed event with its id.
- [ ] Support `Last-Event-ID` so reconnecting clients receive missed events
      from the database.
- [ ] Send periodic heartbeats and clean up subscribers when clients
      disconnect.

### Security

- [ ] Reject API requests whose `Host` header is not `127.0.0.1:<port>` or
      `localhost:<port>`, which guards against DNS rebinding.
- [ ] Reject cross-origin API requests by checking `Origin`, and send no
      permissive CORS headers.
- [ ] Keep all routes read-only in the MVP.

### Phase 7: robustness

- [ ] Clear error when the dev server's fixed port 3000 is already in use.
- [ ] Graceful shutdown that closes SSE streams before the server closes.

## Tests

- [ ] Each route with an in-memory engine or fixture database.
- [ ] Path traversal (`..`, absolute paths, symlinks out of the root) is
      rejected by `/api/files/content`.
- [ ] SSE delivers events in order and replays after `Last-Event-ID`.
- [ ] Requests with a foreign `Host` or `Origin` are rejected.

## Done when

- Every route in the PRD API contract is implemented with shared types.
- The browser never sees data that has not been committed to the database.
