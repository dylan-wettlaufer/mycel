# mycel

See your codebase evolve. Mycel is a local-first developer tool for
understanding structural changes in a codebase.

## Workspace

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
remaining dashboard data is still a placeholder. The CLI, core,
parser, and database implementations are planned in [the PRD](mycel_prd.md).

## Development

Requires Node.js 22 or newer and pnpm 10.34.7 (pinned in `package.json`).
If pnpm is unavailable, run `npx pnpm@10.34.7` in place of `pnpm` below.

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

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
http://127.0.0.1:3000, so the frontend always uses relative API URLs.

For production, build once and start only Hono:

```sh
pnpm build
pnpm start
```

Open http://127.0.0.1:3000. One Node.js server serves both `/api` and the compiled
Vite application in `apps/web/dist`; a Vite process is not needed. Static paths
are resolved relative to the server module, independent of the working
directory. Browser navigation to client routes serves `index.html`; unknown
API routes and missing assets return 404.

The connection badge starts at **Checking…**, then displays **Connected** only
after a successful health response. It checks again every five seconds and
shows **Disconnected** on errors or after a three-second request timeout.

Check that the process is responding:

```sh
curl http://127.0.0.1:3000/api/health
# {"status":"ok"}
```

The health endpoint currently checks process liveness. Indexing and database
readiness are not implemented yet. The server binds only to the loopback
interface. Stop it with Ctrl+C.

To run the compiled server, build first with `pnpm build`, then run
`pnpm --filter @mycel/server start`. The package also exports `createApp()` for
in-process requests and `startServer(port = 3000)` for the future CLI. Importing
the package does not start a listener.

Add shadcn/ui components from `apps/web`, for example
`pnpm dlx shadcn@latest add dialog`. Generated components land in
`apps/web/src/components/ui`.

To build one package and its dependencies:

```sh
pnpm --filter @mycel/core... build
```
