# Contributing to Mycel

This guide covers local development. For what Mycel does and how to use it,
see the [README](README.md). Remaining work is tracked in the
[package task lists](docs/tasks/).

## Setup

Requires Node.js 22 or newer and pnpm 10.34.7 (pinned in `package.json`).
If pnpm is unavailable, run `npx pnpm@10.34.7` in place of `pnpm` below.

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

## Run Mycel during development

For hot reload, run these in separate terminals:

```sh
pnpm dev:server
pnpm dev:web
```

Open http://127.0.0.1:5173. Vite proxies `/api` requests to Hono at
http://127.0.0.1:3000, so the frontend always uses relative API URLs. The
development server indexes the Mycel workspace itself.

To launch the built CLI from the workspace without linking it globally:

```sh
pnpm build
pnpm start
```

This behaves like `mycel`: one Node.js process serves both `/api` and the
compiled dashboard in `apps/web/dist`, and the browser opens at the printed URL.

For a fixed-port server without a browser, run `pnpm build`, then
`pnpm --filter @mycel/server start` at http://127.0.0.1:3000. See the
[server README](packages/server/README.md) for the HTTP API and the exported
startup functions.

## Checks

Run these before committing:

```sh
pnpm typecheck
pnpm test
pnpm lint          # JavaScript, TypeScript, and React hooks
pnpm format:check  # formatting, without changing files
```

`pnpm lint:fix` applies safe lint fixes, and `pnpm format` rewrites formatting.
ESLint checks correctness; Prettier formats TypeScript, JavaScript, JSON, YAML,
CSS, and HTML. Build output, dependencies, coverage, the lockfile, and Markdown
are excluded from formatting.

### Browser workflow tests

Install Chromium once, then run the dashboard workflows:

```sh
pnpm exec playwright install chromium
pnpm test:workflow
```

The workflows use disposable Git repositories and a real server, watcher,
SQLite database, and Chromium browser. They cover structural navigation,
source and diffs, live updates and SSE recovery, and architecture connection
and relationship review. See the
[workflow guide](docs/testing/dashboard-workflow.md) for the dashboard checks
and an external coding agent mode.

## Workspace

| Directory | Package | Responsibility |
| --- | --- | --- |
| `packages/cli` | `@mycel/cli` | Command-line entry point and application lifecycle |
| `packages/agents` | `@mycel/agents` | Provider hook adapters for local attribution |
| `packages/server` | `@mycel/server` | Local HTTP API, events, and static asset serving |
| `packages/core` | `@mycel/core` | Indexing, watching, semantic extraction, and change coordination |
| `packages/parser` | `@mycel/parser` | Source structure extraction |
| `packages/db` | `@mycel/db` | SQLite persistence and queries |
| `packages/shared` | `@mycel/shared` | Shared contracts and utilities |
| `apps/web` | `@mycel/web` | Browser dashboard and source exploration |

Internal dependencies use `workspace:*`, and imports use package names such as
`@mycel/shared`. The CLI uses server and core to launch the dashboard, and
agents and db to record hooks. Server depends on core, and core depends on
parser and db. Shared is available to every package. Web depends only on
shared, which keeps backend modules out of the browser. See the
[system architecture](docs/ARCHITECTURE.md) for how the pieces fit together.

### Builds

`pnpm build` runs in dependency order and emits JavaScript, declarations, and
source maps into each package's `dist/` directory. `pnpm typecheck` builds
first so workspace imports can resolve dependency declarations, then checks
each package without emitting files. To build one package and its
dependencies:

```sh
pnpm --filter @mycel/core... build
```

The server resolves `apps/web/dist` relative to its own module, not the working
directory, so the CLI and the compiled dashboard must stay in the same checkout.

### UI components

Add shadcn/ui components from `apps/web`, for example
`pnpm dlx shadcn@latest add dialog`. Generated components land in
`apps/web/src/components/ui`.

## Commits

Use Conventional Commits such as `feat(parser): add TypeScript symbol
extraction`. See [AGENTS.md](AGENTS.md) for the allowed types and scopes.
