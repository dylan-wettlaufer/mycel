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
other packages are still TypeScript module scaffolds. The CLI, server, parser,
and database implementations are planned in [the PRD](mycel_prd.md).

## Development

Requires Node.js 22 or newer and pnpm 10.34.7 (pinned in `package.json`).
If pnpm is unavailable, run `npx pnpm@10.34.7` in place of `pnpm` below.

```sh
pnpm install
pnpm build
pnpm typecheck
```

Build runs in dependency order and emits JavaScript, declarations, and source
maps into each package's `dist/` directory. Typecheck builds first so workspace
imports can resolve dependency declarations, then checks each package without
emitting additional files.

Internal dependencies use `workspace:*` and imports use package names such as
`@mycel/shared`. The CLI depends on server and core; server depends on core;
core depends on parser and db. Shared is available to every consumer, and web
depends only on shared to keep backend modules out of the browser.

To run the dashboard with hot reload at http://127.0.0.1:5173:

```sh
pnpm dev:web
```

Add shadcn/ui components from `apps/web`, for example
`pnpm dlx shadcn@latest add dialog`. Generated components land in
`apps/web/src/components/ui`.

To build one package and its dependencies:

```sh
pnpm --filter @mycel/core... build
```
