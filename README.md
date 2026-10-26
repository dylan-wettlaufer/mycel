# mycel

See your codebase evolve. Mycel is a local-first developer tool for
understanding structural changes in a codebase.

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

Each launch uses an available port on `127.0.0.1` and prints the dashboard URL.
Use `mycel --no-open` when you want to open the URL yourself, or `mycel --help`
for usage. No subcommand is required.

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

## Workspace

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the parts fit
together and [docs/tasks/](docs/tasks/) for the remaining work in each part.

| Directory | Package | Responsibility |
| --- | --- | --- |
| `packages/cli` | `@mycel/cli` | Command-line entry point and application lifecycle |
| `packages/server` | `@mycel/server` | Local HTTP API, events, and static asset serving |
| `packages/core` | `@mycel/core` | Indexing, watching, and change coordination |
| `packages/parser` | `@mycel/parser` | Source structure extraction |
| `packages/db` | `@mycel/db` | SQLite persistence and queries |
| `packages/shared` | `@mycel/shared` | Shared contracts and utilities |
| `apps/web` | `@mycel/web` | Browser dashboard |

`apps/web` is a Vite + React + TypeScript app styled with Tailwind CSS v4 and
shadcn/ui; it currently renders a dashboard shell with placeholder data. The
Hono backend in `packages/server` serves the built dashboard and exposes a
health endpoint. The dashboard connection badge polls that endpoint; the
repository identity comes from `/api/project`. Structural indexing and database
graph queries are implemented as library APIs. Hono exposes search, node details,
and neighborhood routes. CLI/dev startup indexes the selected repository and
attaches its queries automatically; see [server usage](packages/server/README.md).
Dashboard graph statistics and activity integration remain planned in
[the PRD](mycel_prd.md).

## Development

Requires Node.js 22 or newer and pnpm 10.34.7 (pinned in `package.json`).
If pnpm is unavailable, run `npx pnpm@10.34.7` in place of `pnpm` below.

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

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
repository; live file watching and progress reporting remain planned. The server binds
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

Add shadcn/ui components from `apps/web`, for example
`pnpm dlx shadcn@latest add dialog`. Generated components land in
`apps/web/src/components/ui`.

To build one package and its dependencies:

```sh
pnpm --filter @mycel/core... build
```
