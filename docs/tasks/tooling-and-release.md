# Tooling, testing, and release tasks

Cross-cutting work that does not belong to a single package: workspace setup,
code quality, end-to-end testing, performance, packaging, and the first
release.

## Current state

- pnpm 10.34.7 workspace with `build`, `typecheck`, `test`, `start`,
  `dev:server`, and `dev:web` scripts.
- Strict TypeScript base config in `tsconfig.json`.
- Package tests for cli, server, and web. No continuous integration.
- No linter or formatter configured.

## Tasks

### Phase 1: workspace

- [ ] Choose and configure linting and formatting (open decision 6), with
      root `lint` and `format` scripts.
- [ ] Add `pnpm.onlyBuiltDependencies` for native packages (`better-sqlite3`,
      and Tree-sitter if native bindings are chosen).
- [ ] Add continuous integration that runs install, build, typecheck, lint, and
      test on macOS, Linux, and Windows with Node.js 22.

### Phase 7: testing

- [ ] Fixture repositories under a shared test directory, reused by parser,
      core, and server tests.
- [ ] End-to-end test: launch Mycel on a fixture repository, add a function and
      update its caller, then assert the graph, activity feed, and diff.
- [ ] Run the PRD acceptance test manually with Claude Code modifying a small
      repository.
- [ ] Test on a moderately sized real-world TypeScript repository.

### Phase 7: performance

- [ ] Measure initial index time, incremental update time per stage, query
      latency, and memory use.
- [ ] Confirm visible updates within one second of saving a file on a small
      repository, and document the results.

### Phase 7: packaging

- [ ] Bundle the built dashboard into the CLI package so it runs outside the
      monorepo.
- [ ] Decide whether to publish one package (`mycel`) with internal packages
      bundled in, or several scoped packages.
- [ ] Verify native dependency installs (prebuilt binaries) on each platform.
- [ ] Test `npm install -g` and `npx` from a packed tarball in a clean
      environment.

### Phase 7: documentation and release

- [ ] Keep `README.md` and `docs/ARCHITECTURE.md` current as phases land.
- [ ] Write a short demo walkthrough.
- [ ] Choose a license and add `LICENSE`.
- [ ] Publish the initial open-source release.

## Done when

- A new user can install Mycel with one command, run `mycel` in a TypeScript
  repository, and complete the primary workflow from the PRD.
