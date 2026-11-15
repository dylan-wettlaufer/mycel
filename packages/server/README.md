# @mycel/server

Hono API and static dashboard serving, bound to `127.0.0.1`. The server reads
graph data through `@mycel/core`, which owns storage and indexing.

## Run against this repository

From the workspace root:

```sh
pnpm build
pnpm dev:server
```

In a second terminal:

```sh
curl 'http://127.0.0.1:3000/api/graph/search?q=indexRepository&limit=10'
```

The dev server indexes the Mycel checkout before listening on port 3000. The CLI
does the same for its selected repository on an available port. Both use the
per-repository SQLite database outside the source tree and close it on server
shutdown. Each launch performs a full scan, then watches source files and commits
changes to the graph and source history. Indexing failures abort startup with an error.

`startIndexedServer(port, { project, webDistPath?, databasePath? })` is the shared
startup helper. It returns a listening server with graph routes ready. Use
`databasePath: ":memory:"` for a temporary index, or an absolute path outside
the repository for custom storage. Calling `server.close()` also closes storage.

## Attach graph queries

`createApp({ project, graph, webDistPath? })` supports in-process requests.
`startServer(port, options)` serves the same app over loopback HTTP. Pass a
project-scoped `GraphQueries` object created by core:

```ts
import { createGraphQueries, indexRepository } from "@mycel/core";
import { openDatabase } from "@mycel/db";
import { startServer } from "@mycel/server";

const project = { name: "mycel", root: process.cwd() };
const database = openDatabase({ databasePath: ":memory:" });
try {
  const { projectId } = await indexRepository({ project, database });
  const graph = createGraphQueries(database, projectId);
  const server = startServer(3000, { project, graph });
  server.once("close", () => {
    if (database.open) database.close();
  });
  server.once("error", (error) => {
    if (database.open) database.close();
    console.error(error);
  });
} catch (error) {
  database.close();
  throw error;
}
```

The caller owns the connection and its lifecycle. A query facade fixes the
project ID; HTTP clients cannot switch repositories with request parameters.
When using the lower-level `createApp` or `startServer` without `graph`, valid
graph requests return JSON 503 while health/project/static routes remain
available. CLI/dev startup uses `startIndexedServer` to attach queries automatically.

## Graph routes

| GET route | Query parameters | Response |
| --- | --- | --- |
| `/api/graph/repository` | None | Complete `RepositoryGraph` of files and directed imports, including isolated files |
| `/api/graph/nodes/:id/symbols` | None | All declarations in a file, including nested methods, in source order |
| `/api/graph/search` | Required `q`; optional `limit` (default 20, range 1–100) | `SearchResult` |
| `/api/graph/nodes/:id` | Optional `limit` for each relationship list (default 100, range 1–100) | `NodeDetails` |
| `/api/graph/nodes/:id/neighborhood` | Optional `depth` (default 1, range 0–5) and `limit` (default 100, range 1–500) | `Neighborhood` |

Responses use `@mycel/shared` contracts and include the project ID and committed
snapshot revision. Node details include the node, distinct direct callers,
dependencies, related files, and diagnostics for the node's file, all read in
one database transaction. Dependencies include outgoing `CALLS` and `IMPORTS`.
Related files include the owning file first, followed by files of all direct
callers/dependencies ordered by path; their limit is independent of the other
lists. Each list has its own `truncated` flag.

Search trims `q`, requires 1–1000 characters after trimming, and treats wildcard
characters literally. Exact matches rank before prefix and substring matches.
Neighborhood depth 0 includes only the root. Its size limit includes the root;
all returned edges have endpoints in the returned nodes.

Numeric parameters must contain only decimal digits and stay within the ranges
above. Malformed, repeated, blank, or out-of-range parameters return JSON 400.
Missing nodes return JSON 404. Unexpected query failures return a generic JSON
500; server logs contain the underlying error. API misses return JSON 404 and
never fall through to dashboard HTML. All errors have shape `{ error: string }`.

```sh
curl 'http://127.0.0.1:3000/api/graph/search?q=indexRepository&limit=10'
curl 'http://127.0.0.1:3000/api/graph/nodes/<id>?limit=20'
curl 'http://127.0.0.1:3000/api/graph/nodes/<id>/neighborhood?depth=2&limit=50'
```

Use an ID returned by search, URL-encoded as a path segment. The indexer creates
`CONTAINS`, `IMPORTS`, and resolved `CALLS` edges. Unresolved relationships appear
as diagnostics where supported.

## Verify

```sh
pnpm --filter @mycel/server test
pnpm typecheck
pnpm lint
pnpm test
```

Tests cover in-memory fixture graphs, project isolation, bounded/truncated
results, query validation, JSON errors, loopback HTTP, and existing dashboard
and project/health behavior.

### Dashboard read APIs

- `GET /api/graph/stats` returns project-scoped file, symbol, edge, and diagnostic
  counts with their committed graph revision.
- `GET /api/files/content?path=<repository-relative-path>` returns source captured
  at the current committed graph revision. It only serves indexed files from the
  selected project's database; it never reads arbitrary disk paths. Absolute
  paths, traversal segments, backslashes, and duplicate path parameters are
  rejected.
- `GET /api/changes/:id` returns one saved event so browser links can reopen it
  independently of loaded history pages. Unknown IDs return 404.
- `GET /api/changes/:id/diff` supplies captured before/after file contents. A null
  side means the file did not exist at that revision; an empty string is an empty
  file.
- `GET /api/events` streams ordered changes with SSE IDs and replays after the
  native browser's `Last-Event-ID` on reconnection.


### Feature discovery queries

`GET /api/graph/semantic/features?status=candidate&limit=100` lists heuristic feature
candidates. `status=declared` lists explicit declarations; omit status for both.
`GET /api/graph/semantic/features/:id?limit=100` returns direct associated entities
and their IMPLEMENTS evidence. Both limits are 1–500; the detail limit includes the
feature. Results are scoped to the indexed project and include revision and
truncation. See [discovery rules](../../docs/FEATURE_DISCOVERY.md) for semantics.
