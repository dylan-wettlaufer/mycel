# Tooling, testing, and release tasks

Cross-cutting work that does not belong to a single package: workspace setup,
code quality, end-to-end testing, performance, packaging, and releases.

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

- [x] Bundle the internal packages, dashboard, and agent skill into one npm
      package, with `mycel` as the executable.
- [x] Confirm publishing access for `@dylan-wettlaufer/mycel`.
- [ ] Verify native dependency installs (prebuilt binaries) on each platform.
- [x] Test a global install and `npm exec` from the packed tarball outside
      the workspace.

Run `pnpm package` to build a tarball in `dist/npm/`, or `pnpm test:package`
to build it and test both install paths. For future releases, set the version in
`packages/cli/package.json` before building the release tarball. Publish the
tested tarball with public access.

### Phase 7: documentation and release

- [ ] Keep `README.md` and `docs/ARCHITECTURE.md` current as phases land.
- [ ] Write a short demo walkthrough.
- [x] Include the MIT `LICENSE`.
- [x] Publish the initial open-source release as
      [`@dylan-wettlaufer/mycel@0.1.0`](https://www.npmjs.com/package/@dylan-wettlaufer/mycel/v/0.1.0).

## Done when

- A new user can install Mycel with one command, run `mycel` in a TypeScript
  repository, and complete the primary workflow from the PRD.
