# Mycel architecture

Mycel is a local-first tool that keeps a live structural graph of a TypeScript
repository and shows how it changes. Running `mycel` in a repository starts a
single local Node.js process that indexes the code, watches for changes, stores
graph state and history in SQLite, and serves a browser dashboard.

This document describes the system as it exists today and the target design
from [the PRD](../mycel_prd.md). Sections marked **Current** describe code in
the repository; sections marked **Planned** describe intended design that is not
implemented yet. Per-part work lists live in [`docs/tasks/`](tasks/).

## Guiding principles

- **The repository is the source of truth.** The graph is derived from source
  code, never maintained by hand or by agents. Agent metadata (post-MVP) is
  supplementary.
- **Local only.** The server binds to `127.0.0.1`, source never leaves the
  machine, and no account or cloud service is required.
- **Persist, then broadcast.** Graph and event writes are transactional, and
  the browser only hears about a change after it is committed.
- **Do not invent structure.** References that cannot be resolved statically
  stay unresolved; Mycel records a diagnostic rather than guessing an edge.
- **Independent engine.** The parser and indexing engine do not depend on the
  HTTP server or the frontend.

## System overview

```text
                         one Node.js process (backend)
 ┌──────────────────────────────────────────────────────────────────────┐
 │                                                                      │
 │  @mycel/cli ── resolves repo, starts engine + server, opens browser  │
 │       │                                                              │
 │       ├──────────────► @mycel/server (Hono)                          │
 │       │                  REST queries · SSE · static dashboard       │
 │       │                        │                                     │
 │       ▼                        ▼                                     │
 │  @mycel/core  ◄────────────────┘  engine API: queries + event stream │
 │    indexer · watcher (Chokidar) · change detection · event bus       │
 │       │                    │                                         │
 │       ▼                    ▼                                         │
 │  @mycel/parser         @mycel/db                                     │
 │   Tree-sitter           SQLite (better-sqlite3), migrations, queries │
 │                                                                      │
 └──────────────────────────────────────────────────────────────────────┘
          ▲  HTTP + SSE on 127.0.0.1:<port>
          │
 ┌────────┴─────────┐
 │  apps/web        │  Vite-built React app served as static files
 │  (browser)       │  talks only to /api; never touches disk or SQLite
 └──────────────────┘

 @mycel/shared — types and contracts used by every package and the browser
```

## Packages

| Package | Path | Responsibility | Status |
| --- | --- | --- | --- |
| `@mycel/cli` | `packages/cli` | `mycel` command, repository resolution, process lifecycle | Current: launches server and browser |
| `@mycel/server` | `packages/server` | Hono app: REST API, SSE, static dashboard | Current: `/api/health`, `/api/project`, static serving |
| `@mycel/core` | `packages/core` | Indexing, watching, change detection, event bus | Planned (empty scaffold) |
| `@mycel/parser` | `packages/parser` | Tree-sitter extraction of symbols, imports, calls | Current: pure TS/TSX extraction with diagnostics |
| `@mycel/db` | `packages/db` | SQLite schema, migrations, transactional writes, queries | Planned (empty scaffold) |
| `@mycel/shared` | `packages/shared` | Shared types and API contracts | Current: project/graph/query contracts, health, source ranges, diagnostics |
| `@mycel/web` | `apps/web` | Browser dashboard | Current: shell, health badge, project header, sample data |
| `@mycel/agents` | `packages/agents` | Agent adapters and attribution (post-MVP) | Not created yet |

### Dependency rules

```text
cli ──► server ──► core ──► parser
 │                  │
 └──────► core      └─────► db

every package ──► shared
web ──► shared only
```

- `web` depends only on `shared`, so no backend module can end up in the
  browser bundle.
- `server` reaches data through `core`, not by importing `db` directly. This
  keeps one owner for the SQLite connection and for the rule that writes happen
  before broadcasts.
- `parser` is pure: it turns source text into structure and does not read the
  file system, touch SQLite, or know about the server.
- `db` knows about storage, not about parsing or HTTP.
- Workspace imports use package names (`@mycel/core`) and `workspace:*`
  versions. Each package builds with `tsc` into `dist/`; `pnpm -r build` runs in
  dependency order.

## Runtime flow

### Launch (current)

1. `mycel` (`packages/cli/src/bin.ts`) parses `--help`, `--version`, and
   `--no-open`.
2. `resolveRepository` runs `git rev-parse --show-toplevel` from the working
   directory. Outside Git it uses the current folder.
3. `launchDashboard` checks that `apps/web/dist/index.html` exists, then calls
   `startServer(0, { project, webDistPath })` so the OS picks a free port on
   `127.0.0.1`.
4. The CLI prints the URL and opens the browser. `SIGINT` and `SIGTERM` close the
   server.

### Launch (planned)

Between steps 2 and 3, the CLI opens the project's database, creates the core
engine, and runs the initial index. The engine is passed to `createApp` so
routes can query it and subscribe to its events. The dashboard opens as soon as
the server is listening; indexing progress is reported through `/api/health`
and SSE rather than blocking the launch.

### Change pipeline (planned)

```text
file saved
  → watcher event (Chokidar), debounced per path
  → read file, compare content hash; skip if unchanged
  → parser extracts nodes, edges, diagnostics for that file
  → resolver re-links imports/calls affected by changed exports or symbols
  → diff old vs. new graph state for the file → change set
  → one SQLite transaction: nodes, edges, diagnostics, source snapshot,
    change events, new revision
  → commit succeeds → event bus emits committed events
  → server pushes them over SSE → dashboard updates
```

Each stage should be timed separately so the "visible within one second" target
for small repositories can be measured: detection, parse, resolve, database
write, and browser delivery.

## Data model (planned)

Types live in `@mycel/shared` so the backend and browser agree on shapes.
Structural graph, project, query, and health contracts are now defined; storage,
ID/hash generation, and query execution remain planned. See the
[shared contract semantics](../packages/shared/README.md).

| Entity | Key fields |
| --- | --- |
| Project | id, name, absolute root, indexing settings |
| Node | id, project id, kind (`file`, `function`, `class`, `method`), qualified name, path, source range, content hash, revision |
| Edge | id, project id, source node, target node, kind (`CONTAINS`, `IMPORTS`, `CALLS`; `REFERENCES` only once resolution is reliable), revision |
| Diagnostic | file, location, severity, parser or resolution message |
| Change event | monotonic id, timestamp, entity type and id, action (`created`, `modified`, `deleted`), before and after revision references, optional attribution |
| Snapshot | path, revision, full source content (needed for diffs) |
| Session | start and end time, starting graph revision |
| Agent session (post-MVP) | provider, session id, tool metadata, attribution evidence |

Identity rules:

- **Stable ids do not depend on line numbers alone.** The proposed id is a hash
  of project, path, node kind, and qualified name, with a disambiguating ordinal
  for duplicates in the same scope. A function that moves down a file keeps its
  id; a renamed function becomes a delete plus a create.
- **Revisions are monotonic per project.** Every committed change set gets a
  new revision. Events reference the before and after revisions so the server
  can rebuild a diff from snapshots.
- **Content hashes are for change detection, not history.** Diffs need the
  stored source, so snapshots hold full content under a retention policy.

## HTTP API

All routes are under `/api`, return JSON unless noted, and use types from
`@mycel/shared`. Unknown `/api` routes return 404 and never fall through to the
dashboard HTML.

| Method | Route | Purpose | Status |
| --- | --- | --- | --- |
| GET | `/api/health` | Process liveness, later index and database status | Current (liveness only) |
| GET | `/api/project` | Selected repository name and root | Current |
| GET | `/api/graph/search?q=` | Search files and symbols | Planned |
| GET | `/api/graph/nodes/:id` | Node metadata | Planned |
| GET | `/api/graph/nodes/:id/neighborhood` | Bounded connected subgraph | Planned |
| GET | `/api/files/content?path=` | Source content, constrained to the repository root | Planned |
| GET | `/api/changes` | Paginated change history | Planned |
| GET | `/api/changes/:id/diff` | Before and after source for a change | Planned |
| GET | `/api/events` | SSE stream of committed events, resumable with `Last-Event-ID` | Planned |

Non-API `GET` requests that accept HTML serve `index.html` so client-side
routes work. Requests for missing assets return 404.

## Frontend

**Current.** `apps/web` is a Vite 8, React 19, and TypeScript app styled with
Tailwind CSS v4 and shadcn/ui (`new-york` style, components in
`src/components/ui`). The Mycel theme lives in `src/index.css` as CSS
variables, dark by default, with Geist and JetBrains Mono bundled locally.
`useBackendHealth` polls `/api/health` every five seconds, and `useProject`
loads `/api/project` once connected. Statistics and activity are still sample
data from `features/dashboard/mock-data.ts`.

**Planned layout** (from the PRD):

```text
apps/web/src/
├── components/        shared UI (layout, shadcn/ui in components/ui)
├── features/
│   ├── dashboard/     overview stats and recent activity
│   ├── explorer/      searchable file and symbol tree
│   ├── graph/         React Flow neighborhood view
│   ├── activity/      live feed backed by SSE
│   └── source/        Monaco source and diff viewers
├── hooks/
└── lib/               API client, formatting, utilities
```

In development, `pnpm dev:web` runs Vite on port 5173 and proxies `/api` to the
Hono dev server on port 3000 (`pnpm dev:server`). In production, Hono serves
the prebuilt `apps/web/dist`, and Vite is not used at runtime.

## Security and privacy

- Bind only to `127.0.0.1`. **Current.**
- Never send source code to an external service. **Current** by construction:
  there are no outbound calls.
- Constrain file-read APIs to the repository root after resolving symlinks.
  **Planned.**
- Limit browser origins: reject API requests whose `Origin` or `Host` is not the
  local dashboard, which guards against DNS rebinding and cross-site reads.
  **Planned.**
- Store application data outside the tracked repository by default.
  **Planned.**

## Storage location (planned)

The database lives outside the repository so it is never committed. The
proposed location is a per-user Mycel data directory with one database per
project, keyed by a hash of the repository root. The exact path for each
operating system is an open decision; see [`tasks/db.md`](tasks/db.md).

## Testing strategy

| Area | Tooling | Current coverage |
| --- | --- | --- |
| Shared contracts | `tsc` consumer fixtures (`packages/shared/test`) | Public exports, graph/query contracts, legacy payload compatibility, invalid contract rejection |
| CLI | `node --test` (`packages/cli/test`) | Repository resolution, launch, executable lifecycle |
| Server | `node --test` (`packages/server/test`) | Health, project, static serving, API 404s |
| Web | Vitest + Testing Library (jsdom) | Health polling, app rendering with project data |
| Parser | `node --test` (`packages/parser/test`) | TS/TSX fixtures, containment, imports/exports, callers, recovery, ranges, identities, large files |
| Db, core | Planned: fixture repositories and in-memory SQLite | None yet |
| End to end | Planned | None yet |

The MVP acceptance test from the PRD: start Mycel on a small TypeScript
repository, have a coding agent add a function and update its caller, then
confirm the graph and activity feed update and the source diff is correct.

## Build and packaging

- pnpm 10.34.7 workspace, Node.js 22 or newer, TypeScript 5.9 in strict mode
  with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
- `pnpm build` builds every package; `pnpm typecheck` builds, then checks;
  `pnpm test` runs each package's tests.
- `pnpm start` runs the built CLI from the workspace. The CLI currently finds
  the dashboard through a relative path into `apps/web/dist`, so it only works
  from a checkout. Bundling the dashboard into the CLI package is a release task.
- `better-sqlite3` and Tree-sitter ship native code. pnpm 10 skips dependency
  build scripts unless they are allowed, so they must be added to
  `pnpm.onlyBuiltDependencies` when introduced.

## Task lists

| Part | Tasks |
| --- | --- |
| Shared contracts | [`tasks/shared.md`](tasks/shared.md) |
| Parser | [`tasks/parser.md`](tasks/parser.md) |
| Database | [`tasks/db.md`](tasks/db.md) |
| Core engine | [`tasks/core.md`](tasks/core.md) |
| HTTP server | [`tasks/server.md`](tasks/server.md) |
| CLI | [`tasks/cli.md`](tasks/cli.md) |
| Web dashboard | [`tasks/web.md`](tasks/web.md) |
| Agent attribution (post-MVP) | [`tasks/agents.md`](tasks/agents.md) |
| Tooling, testing, and release | [`tasks/tooling-and-release.md`](tasks/tooling-and-release.md) |

A suggested order that reaches the PRD's first milestone (file save, then
updated graph, then persisted event, then live browser update) quickly:
shared graph types, then parser, then db schema and queries, then core full
index, then server graph routes, then core watcher and change events, then SSE,
then the web activity feed, explorer, graph, and source views.

## Open decisions

These need a decision before or during the relevant phase:

1. **Texo reuse.** Parser decision resolved: build from scratch without copying
   Texo code or fixtures. Graph/source-viewer reuse remains a separate decision.
2. **Tree-sitter binding.** Resolved: native `tree-sitter@0.21.1` with
   `tree-sitter-typescript@0.23.2`, matching the grammar's peer dependency.
   This gives the Node backend a synchronous API without WASM initialization
   or asset loading. See [parser usage](../packages/parser/README.md).
3. **Data directory.** Exact per-OS location and whether a `--data-dir` option
   is needed.
4. **History retention.** How many snapshots and events to keep, and whether it
   can be configured.
5. **Rename detection.** Chokidar reports a rename as unlink plus add; whether
   to pair them by content hash within a time window.
6. **Linting and formatting.** The PRD lists this for phase 1, but no tool is
   configured yet (for example ESLint plus Prettier, or Biome).
7. **Import resolution scope.** How far to honor `tsconfig` `paths`,
   `baseUrl`, package `exports`, and workspace packages in the first version.
