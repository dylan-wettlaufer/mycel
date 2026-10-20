# AGENTS.md — Mycel

## Project
Mycel is a local-first codebase visualization tool that automatically indexes source code and displays a live knowledge graph.

**Stack:** TypeScript, pnpm monorepo, React, Vite, Hono, Tree-sitter, SQLite, React Flow, Tailwind CSS, and shadcn/ui.

## Development Guidelines
- Follow the existing monorepo structure and package boundaries.
- Keep code simple, modular, readable, and type-safe.
- Reuse existing functionality before introducing new abstractions or dependencies.
- Keep the parser and indexing engine independent of the HTTP server and frontend.
- Always use **shadcn/ui components when possible**. Extend existing components before building custom alternatives.
- Follow existing project styling and design conventions.
- Add or update tests when changing important functionality.
- **Ask clarifying questions whenever requirements are ambiguous or you're unsure about an implementation decision.** Do not make significant assumptions without confirmation.

Testing: Write tests for core functionality, complex logic, and bug fixes. Avoid trivial or redundant tests. Prioritize meaningful coverage over test quantity.

## Git Commit Conventions
Use **Conventional Commits**:

`<type>(<scope>): <description>`

Types:
- `feat` — New functionality
- `fix` — Bug fixes
- `refactor` — Code restructuring
- `chore` — Maintenance and setup
- `docs` — Documentation
- `test` — Tests
- `perf` — Performance improvements
- `build` — Build configuration or dependencies
- `ci` — CI/CD changes
- `style` — Formatting only

Scopes: `web`, `cli`, `server`, `core`, `parser`, `db`, `shared`.

Examples:
- `feat(parser): add TypeScript symbol extraction`
- `fix(core): handle deleted files`
- `chore: initialize pnpm monorepo`

Use lowercase, imperative descriptions without trailing periods. Keep commits focused on one logical change.
