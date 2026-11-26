# Mycel architecture

Mycel turns a TypeScript repository into a living view of the application's
architecture. The structural index supplies source evidence for features,
flows, and subsystems. The browser presents those concepts at a useful level of
detail and lets the developer follow them back to the code.

This guide describes the current engine and the target V0 experience. The
[product requirements](../mycel_prd.md) define the vision, principles, and
release criteria.

## System overview

One local Node.js process indexes the repository, watches for edits, stores
graph state and history in SQLite, and serves the browser UI. The browser
consumes project-scoped HTTP queries and server-sent events (SSE).

| Package | Responsibility |
| --- | --- |
| [`@mycel/cli`](../packages/cli/) | Resolve the repository, start the indexed server, and open the browser. |
| [`@mycel/parser`](../packages/parser/README.md) | Extract TypeScript and TSX structure, Python imports, and source ranges through Tree-sitter. |
| [`@mycel/core`](../packages/core/README.md) | Discover and watch files, resolve references, build structural and semantic graphs, and publish committed changes. |
| [`@mycel/db`](../packages/db/README.md) | Own SQLite migrations, persistence, revisions, history, and queries. |
| [`@mycel/server`](../packages/server/README.md) | Expose Core's project-scoped queries and SSE through Hono and serve the built UI. |
| [`@mycel/shared`](../packages/shared/README.md) | Define browser-safe types and API contracts. |
| [`@mycel/web`](../apps/web/) | Present graph views, feature details, source, and activity in React. |

The CLI starts the server, which uses Core's indexed project lifecycle. Core
uses the parser and database independently of HTTP. The parser works with
supplied source text. The database owns storage and query behavior. The web
app depends on `@mycel/shared` for repository-specific contracts and accesses
indexed data through `/api`.

## Data model

### Structural facts

The parser extracts files, declarations, imports, exports, call sites, source
ranges, and diagnostics. Core builds `CONTAINS`, resolved local `IMPORTS`, and
supported `CALLS` relationships. Import and export facts support module
resolution. Unsupported or ambiguous references remain unresolved, with
diagnostics where supported.

Core hashes the canonical repository root for the project ID. Structural
node IDs include the project ID and parser identity, including path, kind,
lexical name, static/accessor distinction, and duplicate ordinal. A named
declaration keeps its ID when it shifts lines within a file. A move or rename
can change it, and anonymous declarations have occurrence-based identities.
Edge IDs incorporate the project, relationship kind, and endpoints.

### Semantic mappings

Current extractors attach semantic entities and relationships to structural
files or symbols with source paths, ranges, and provenance. Supported React and
Next.js patterns, explicit declarations, and heuristic discovery supply the
semantic layer. Behavior traces follow supported bindings, requests, and data
access, with explicit boundaries where the extractor cannot continue. Static
evidence establishes a source-level reference or binding. Runtime execution
remains outside that evidence.

The current feature model supports project-scoped declarations and inferred
candidates. Candidates are keyed by project, owning package, and area name.
Line shifts preserve identity, while renaming the area or promoting a
candidate to a declaration can change its ID. See [the semantic graph](SEMANTIC_GRAPH.md),
[feature discovery](FEATURE_DISCOVERY.md), and [behavior tracing](BEHAVIOUR_TRACING.md).

**V0 target.** Represent features, flows, and technical subsystems as distinct
concepts. Give logical features IDs independent of their implementation paths,
so source anchors can be reconciled as files move. Build architecture-level
relationships from supporting source-backed relationships, retaining the
evidence for each displayed connection. Inferred membership can help organize
the map. A group assignment alone cannot establish a call or data flow.

### Agent-proposed context (V0 target)

Agents may propose names, descriptions, groupings, or source references as
semantic input. Keep the proposal's origin and review its claims against the
current project revision. Resolve referenced files and symbols to current
anchors and corroborate asserted imports, calls, and other relationships
using the index and supported extractors. A valid source reference grounds the
proposal in code. The meaning or grouping suggested by the agent retains its
own provenance. Unsupported claims remain unverified context and cannot supply
a verified edge. When source changes, revalidate affected mappings before they
support the architecture view.

The existing semantic contract has a provenance model and supports explicit
source annotations and heuristic discovery. Agent proposal ingestion and
stable identity reconciliation are V0 work. Agent session and edit attribution
are a separate [post-V0 capability](tasks/agents.md).

## Runtime flow

### Launch

`mycel` resolves the Git working-tree root, falling back to the current
directory outside Git. `startIndexedServer` opens the repository's external
SQLite database through Core. Core starts watching before the initial scan,
reconciles startup saves and offline changes, then exposes the committed
index. The server starts listening on an available loopback port and the CLI
opens the browser unless `--no-open` was passed. Shutdown closes the watcher
and database. See [server startup](../packages/server/README.md#run-against-this-repository).

### Change pipeline

1. Chokidar observes relevant source and metadata changes. Core coalesces
   bursts of changes and skips unchanged source content hashes.
2. Core reparses changed source and reuses cached facts for unchanged files.
   The resolver rebuilds relationships from the accepted captures. On a live
   parse failure, previously valid source and graph facts are retained when
   available, together with a current diagnostic.
3. Semantic enrichment runs against the accepted captures, replacing obsolete
   derived records. Core computes structural node and edge changes.
4. SQLite commits the graph, semantic snapshot, diagnostics, source
   snapshots, history events, and a new project revision in one transaction.
   Failed writes leave the previous committed state intact.
5. Hono streams committed structural change events over SSE. The browser
   batches the events and refetches the relevant data for open views, including
   feature queries. See [history and SSE behavior](HISTORY.md).

**V0 target.** Refresh the affected architecture and feature views after
reconciling source mappings, with the map and evidence tied to the same
committed revision. The refresh path must also cover commits that affect
semantic mappings without generating a structural change event. Preserve the
user's scope if it still exists and provide a path back to the map when it
disappears.

## HTTP API

Current reads are scoped to the selected repository. Graph responses identify
the committed project revision, and bounded queries report truncation where
applicable.

| Route | Purpose |
| --- | --- |
| `GET /api/health` and `GET /api/project` | Process liveness and selected repository metadata. |
| `GET /api/graph/repository` | Indexed files and directed imports for the current folder overview. |
| `GET /api/graph/search` and `GET /api/graph/nodes/:id` | Find files and symbols, then read relationships and diagnostics. |
| `GET /api/graph/nodes/:id/neighborhood` | Bounded structural graph around a node. |
| `GET /api/graph/semantic` | Bounded semantic snapshot with source mappings and provenance. |
| `GET /api/graph/semantic/features` and `GET /api/graph/semantic/features/:id/behaviour` | Feature list, membership, and supported behavior traces. |
| `GET /api/files/content?path=…` | Captured source for an indexed repository-relative path. |
| `GET /api/changes`, `GET /api/changes/:id/diff`, and `GET /api/events` | Change history, source diffs, and replayable SSE. |

See the [server reference](../packages/server/README.md), [semantic API](SEMANTIC_GRAPH.md#query-api),
and [history API](HISTORY.md#read-only-http-api) for routes and query bounds.
Hono validates request parameters and delegates to Core's query layer.
Core and SQLite should provide scoped query results for the V0 architecture
view and its drill-downs.

## Frontend

**Current.** The default **Graph** view maps architecture parts and shows
resolved imports and calls. **Explorer** searches files and symbols.
**Activity** opens saved changes and source diffs. Hash
navigation preserves top-level selections across reloads and browser
Back/Forward. The header reports HTTP health and SSE status separately.

**V0 target.** The first screen is the architecture map. Selecting a feature
opens its internal components and behaviors, and selecting a step or
connection opens its source evidence. Keep the current scope visible and
restore it on return from source or when navigating back to the map. Use
bounded views so files and symbols appear at the point where they help answer
the developer's question.

The web app uses React Flow, Monaco, Tailwind CSS, and shadcn/ui. In development,
Vite on port 5173 proxies `/api` to Hono on port 3000. A built installation
serves the frontend directly from Hono.

## Security and privacy

- The server binds to `127.0.0.1`. Indexing, storage, and visualization are local.
- Source queries read accepted project snapshots from SQLite and validate
  repository-relative paths. Discovery skips symlinked files and directories.
- SQLite lives outside the tracked repository. Explicit database paths are
  checked against the canonical repository root.
- Agent-assisted semantics must preserve the local processing model and keep
  validation scoped to the selected repository.

## Storage location

`resolveDatabasePath` selects a database named by a hash of the canonical
repository root in a `projects/` subdirectory of the per-user Mycel directory.
macOS uses `~/Library/Application Support/Mycel`, Linux uses `$XDG_DATA_HOME/mycel`
with a `~/.local/share/mycel` fallback, and Windows uses `%LOCALAPPDATA%\Mycel`
with a `~\AppData\Local\Mycel` fallback. Graph and source snapshots share
revision references so saved diffs remain available after an entity is deleted.
See [database usage](../packages/db/README.md) and [history retention](HISTORY.md#storage-and-retention).

## Testing strategy

Package tests cover extraction, resolution, semantic evidence, persistence,
watcher reconciliation, API contracts, and browser components. The Chromium
workflow runs against a temporary repository with the actual server, index, and
watcher. It covers structural navigation, source and diffs, live changes, and
reconnects. A separate feature workflow exercises discovery, behavior
navigation, and source. See [dashboard workflow validation](testing/dashboard-workflow.md).

V0 release validation adds an architecture-to-source round trip, source-backed
architecture changes after an edit, stable feature identity through file moves,
and independent validation of agent-proposed references and relationships.
See [V0 acceptance criteria](../mycel_prd.md#minimum-v0-scope).

## Build and packaging

`pnpm build` builds the workspace in dependency order. `pnpm typecheck` builds
and then checks all packages. `pnpm test` runs package tests, and
`pnpm test:workflow` runs the Chromium workflows.

`pnpm package` builds the standalone npm tarball. The installed CLI resolves
the bundled dashboard and agent skill relative to its installation. npm installs
SQLite and Tree-sitter as dependencies. `pnpm test:package` tests the tarball
outside the workspace. See the [release checklist](tasks/tooling-and-release.md).

## Task lists

| Part | Tasks |
| --- | --- |
| Shared contracts | [Shared](tasks/shared.md) |
| Parser | [Parser](tasks/parser.md) |
| Database | [Database](tasks/db.md) |
| Core engine | [Core](tasks/core.md) |
| HTTP server | [Server](tasks/server.md) |
| CLI | [CLI](tasks/cli.md) |
| Web dashboard | [Web](tasks/web.md) |
| Agent context and attribution | [Agents](tasks/agents.md) |
| Tooling, testing, and release | [Tooling and release](tasks/tooling-and-release.md) |

## Open decisions

V0 design still needs a durable feature identity and reconciliation model, an
agent proposal format and intake mechanism, and a query and update contract for
the architecture view. Operational decisions include automatic history
retention, progress reporting during startup, and how to represent file
renames in history. See the [product requirements](../mycel_prd.md#minimum-v0-scope)
for the required outcomes.
