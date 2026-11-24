# Tooling, testing, and release tasks

Cross-cutting work that does not belong to a single package: workspace setup,
code quality, end-to-end testing, performance, packaging, and the first
release.

## Current state

- pnpm 10.34.7 workspace with `build`, `typecheck`, `test`, `start`,
  `dev:server`, and `dev:web` scripts.
- Strict TypeScript base config in `tsconfig.json`.
- Package tests run in GitHub Actions on Ubuntu at the Node 22.22.2, 24.15.0,
  and 26.0.0 support floors after a frozen-lockfile install.
- ESLint and Prettier run through the root `lint` and `format` scripts.

## Tasks

### Phase 1: workspace

- [x] Configure linting and formatting with root `lint` and `format` scripts.
- [x] Add `pnpm.onlyBuiltDependencies` for SQLite and Tree-sitter.
- [x] Run frozen-lockfile installs and the package test suite in Linux CI at
      each supported Node release floor.
- [ ] Extend CI to macOS and Windows and add explicit build, typecheck,
      and lint checks.

### Phase 7: testing

- [ ] Fixture repositories under a shared test directory, reused by parser,
      core, and server tests.
- [x] End-to-end test: launch Mycel on a fixture repository, add a function and
      update its caller, then assert the graph, activity feed, and diff.
- [ ] Run the [V0 release validation](../../mycel_prd.md#release-validation) for
      the architecture map, source drill-down, live edits, and agent proposals.
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
