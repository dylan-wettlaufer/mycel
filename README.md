# mycel

> Mycel helps developers understand what their AI agents are building and how it fits into the rest of their application.

Mycel is a local-first tool for keeping a mental model of an application as
its code evolves. The V0 experience starts with a living architecture map of
features and subsystems such as Orders, Payments, and persistence. A developer
can open Orders, follow a source-backed connection to Payments, and inspect
the exact handler behind it. The map updates as developers and agents edit
the code.

See the [product vision and V0 requirements](mycel_prd.md) and
[system architecture](docs/ARCHITECTURE.md).

## Open a repository

Run `mycel` from a repository or any of its subdirectories:

```sh
cd /path/to/your/repository
mycel
```

Mycel resolves the Git working-tree root, indexes the repository, starts one local server, and opens the
dashboard in your default browser. Outside Git, it opens the current folder.
The dashboard shows the selected repository's name and absolute path. The
terminal stays running; press Ctrl+C to stop the server and close its database.

Mycel indexes TypeScript, TSX, and Python. Python maps show file-to-file
connections from module-level imports.

Each launch uses an available port on `127.0.0.1` and prints the dashboard URL.
Use `mycel --no-open` when you want to open the URL yourself, or `mycel --help`
for usage. No subcommand is required.

### Describe your architecture with an agent

Without `.mycel/architecture.json`, the map shows one part per workspace
package or top-level folder. To name real subsystems, install the agent skill
and ask Codex or Claude Code to use it:

```sh
mycel install-skill   # writes .agents/skills and .claude/skills
mycel architecture    # validates the file the agent wrote
```

`mycel architecture` lists unassigned files, tie warnings, and patterns that
match no indexed file. It exits with status 1 when the file is missing or
invalid, or when a pattern matches nothing.

To extend a specific part of the map, ask your coding agent to use the skill
for that component, for example “Add a Mycel drill-down for Repository
indexing.” The first responsibility in the resulting breakdown is the opening
focus. Use `mycel architecture --component indexer` to inspect owned files,
indexed callers and dependencies, overlaps, and files grouped under
**Other files**.

### Install from source

Requires Node.js 22 or newer and pnpm 10.34.7. From the Mycel workspace:

```sh
pnpm install
pnpm build
npx pnpm@10.34.7 link --global ./packages/cli
```

If pnpm reports that its global bin directory is missing from PATH, run
`pnpm setup`, restart your shell, and retry the link command. Linking keeps the
command connected to this checkout; rebuild after changing source code. The
CLI and compiled dashboard must remain in the checkout together.

## Current experience

- **Features** lists declared features and inferred candidates for supported
  code patterns. Open a feature to explore its supported behavior traces and
  source evidence. See [feature discovery](docs/FEATURE_DISCOVERY.md) and
  [behavior tracing](docs/BEHAVIOUR_TRACING.md).
- **Graph**, the landing view, maps architecture parts and their resolved
  imports and calls. Open a connection to inspect its evidence. Mycel keeps
  open evidence aligned with the indexed source as you save edits. The map
  surfaces recent relationship additions and removals, including small links.
  Use **Open files** to inspect file dependencies, symbols, and source.
  Use **Only connections** to narrow the graph or **Focus selection** to
  frame a node and its neighbors.
- **Explorer** searches indexed files and symbols. **Activity** groups
  edits by file and indexed save, including uncommitted edits. Each entry
  shows a source diff and the symbols that changed. **Relationships** shows
  added and removed calls and imports, with links to affected behavior where
  Mycel has trace evidence.
  Graph and change selections can be reopened through browser history or
  hash links.

The Hono backend serves the dashboard and project-scoped graph, captured source,
history, and SSE APIs. Mycel starts watching during the initial index and
continues watching while it runs. The header shows backend health and live-stream
connection state separately. See [server usage](packages/server/README.md).

## Workspace

| Directory | Package | Responsibility |
| --- | --- | --- |
| `packages/cli` | `@mycel/cli` | Command-line entry point and application lifecycle |
| `packages/server` | `@mycel/server` | Local HTTP API, events, and static asset serving |
| `packages/core` | `@mycel/core` | Indexing, watching, semantic extraction, and change coordination |
| `packages/parser` | `@mycel/parser` | Source structure extraction |
| `packages/db` | `@mycel/db` | SQLite persistence and queries |
| `packages/shared` | `@mycel/shared` | Shared contracts and utilities |
| `apps/web` | `@mycel/web` | Browser dashboard and source exploration |

See the [package task lists](docs/tasks/) for remaining work.

## Development

Requires Node.js 22 or newer and pnpm 10.34.7 (pinned in `package.json`).
If pnpm is unavailable, run `npx pnpm@10.34.7` in place of `pnpm` below.

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

### Browser workflow tests

Install Chromium once, then run the full dashboard workflow:

```sh
pnpm exec playwright install chromium
pnpm test:workflow
```

The workflows use disposable Git repositories and a real server, watcher,
SQLite database, and Chromium browser. They cover structural navigation,
source and diffs, live updates and SSE recovery, and feature behavior
navigation. See the [workflow guide](docs/testing/dashboard-workflow.md)
for the dashboard checks and an external coding agent mode.

Code quality commands run across the workspace:

```sh
pnpm lint          # Check JavaScript, TypeScript, and React hooks
pnpm lint:fix      # Apply safe automatic lint fixes
pnpm format        # Format source code and configuration files
pnpm format:check  # Check formatting without changing files
```

ESLint checks code correctness; Prettier handles consistent formatting.
Formatting covers TypeScript, JavaScript, JSON, YAML, CSS, and HTML. Generated
build output, dependencies, coverage, and the lockfile are excluded. Markdown
documents are not automatically reformatted. Run linting and the formatting
check alongside `pnpm typecheck` and `pnpm test` before committing.

Build runs in dependency order and emits JavaScript, declarations, and source
maps into each package's `dist/` directory. Typecheck builds first so workspace
imports can resolve dependency declarations, then checks each package without
emitting additional files.

Internal dependencies use `workspace:*` and imports use package names such as
`@mycel/shared`. The CLI depends on server and core; server depends on core;
core depends on parser and db. Shared is available to every consumer, and web
depends only on shared to keep backend modules out of the browser.

For development with hot reload, run these commands in separate terminals:

```sh
pnpm dev:server
pnpm dev:web
```

Open http://127.0.0.1:5173. Vite proxies `/api` requests to Hono at
http://127.0.0.1:3000, so the frontend always uses relative API URLs. The
standalone development server selects the Mycel workspace itself.

To launch Mycel directly from the workspace without globally linking it:

```sh
pnpm build
pnpm start
```

This is the same default launch as `mycel`: the browser opens automatically at
the URL printed in the terminal. One Node.js process serves both `/api` and the
compiled Vite application in `apps/web/dist`; a Vite process is not needed.
Static paths are resolved relative to the server module, independent of the
working directory. Browser navigation to client routes serves `index.html`; unknown
API routes and missing assets return 404.

The connection badge starts at **Checking…**, then displays **Connected** only
after a successful health response. It checks again every five seconds and
shows **Disconnected** on errors or after a three-second request timeout.

Check that the process is responding:

```sh
curl 'http://127.0.0.1:<port>/api/health'
# {"status":"ok"}
```

Replace `<port>` with the port printed by `mycel` (or use port 3000 for
`pnpm dev:server`). The health endpoint currently checks process liveness.
Startup completes an initial index before listening. Each restart rescans the
repository and watches source changes while running. Progress reporting remains planned. The server binds
only to the loopback interface. Stop it with Ctrl+C.

For a fixed-port server without browser launch, build first with `pnpm build`,
then run `pnpm --filter @mycel/server start` at http://127.0.0.1:3000. The server
package exports `createApp(options)` for in-process requests and
`startIndexedServer(port, options)` for startup with indexing, and
`startServer(port = 3000, options)` for callers supplying their own graph queries. Importing either the server or
CLI package does not start a listener or open a browser.

Query the indexed graph using the dev server (port 3000) or the CLI's printed port:

```sh
curl 'http://127.0.0.1:3000/api/graph/search?q=indexRepository&limit=10'
```

Use an ID from `nodes` to request `/api/graph/nodes/<id>` or
`/api/graph/nodes/<id>/neighborhood?depth=2&limit=50`. See
[graph route parameters](packages/server/README.md#graph-routes) for limits.

Semantic application graphs are indexed alongside the structural graph. Query
`/api/graph/semantic?limit=100` and
`/api/graph/semantic/<id>/neighborhood?depth=4&limit=100` for supported React/TSX
and Next.js applications. See [semantic extraction rules and source annotations](docs/SEMANTIC_GRAPH.md)
for the supported scope and fixture path. Automatic candidates and their memberships
are available at `/api/graph/semantic/features?status=candidate` and
`/api/graph/semantic/features/<id>`. See [feature discovery rules](docs/FEATURE_DISCOVERY.md)
for confidence, explicit overrides, and limitations.

Evidence-backed behaviour traces are available at `/api/graph/behaviour/entries`
and `/api/graph/behaviour/<id>?direction=forward&maxDepth=12&maxPaths=20`.
Use `direction=reverse` with a selected structural function ID for supported callers.
See [behaviour tracing scope and boundaries](docs/BEHAVIOUR_TRACING.md) for the
React → native fetch → Next App Router → Prisma path.

Add shadcn/ui components from `apps/web`, for example
`pnpm dlx shadcn@latest add dialog`. Generated components land in
`apps/web/src/components/ui`.

To build one package and its dependencies:

```sh
pnpm --filter @mycel/core... build
```
