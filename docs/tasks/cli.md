# `@mycel/cli` tasks

The `mycel` command. It resolves the repository, owns the process lifecycle,
wires the core engine to the server, and opens the browser.

See [architecture](../ARCHITECTURE.md#runtime-flow).

## Current state

- `mycel`, `mycel --no-open`, `mycel --help`, and `mycel --version` in
  `src/bin.ts`.
- `resolveRepository` uses the Git working-tree root (including linked
  worktrees) and falls back to the current folder outside Git.
- `launchDashboard` checks for the dashboard build, completes the initial index
  through core, starts the server on an OS-assigned port with graph queries,
  and opens the browser. If the browser cannot open, it
  prints the URL instead.
- `SIGINT` and `SIGTERM` close the server and its database.
- Tests in `test/cli.test.mjs`.

## Tasks

### Phase 2 to 4: wire the engine

- [x] Open and index the resolved project through core before starting the
      server, and attach its queries through `startIndexedServer`.
- [ ] Start the server and open the browser right away, and run the initial
      index in the background so launch is not blocked.
- [ ] Print a short indexing summary (files, symbols, duration, diagnostics)
      when the first index completes.
- [ ] Stop the watcher and close the database on shutdown, after the server
      closes.
- [x] Exit with a non-zero code and a clear message if the initial index fails to
      start.

### Options

- [ ] Decide whether `--port` and `--data-dir` options are needed (open
      decision 3).
- [ ] Consider a `--verbose` flag that prints the per-stage timings from core.

### Phase 7: robustness and packaging

- [ ] Detect a stale or already-running Mycel instance for the same repository
      and either reuse its URL or explain how to stop it.
- [ ] Handle uncaught errors and unhandled rejections with a clean shutdown.
- [ ] Stop relying on the relative path into `apps/web/dist`. Copy the built
      dashboard into the CLI package (for example `dist/web`) during build so
      the published package is self-contained.
- [ ] Test `npm install -g` from a packed tarball outside the monorepo.

## Tests

- [ ] Launch with a fixture repository and confirm `/api/health` reports the
      index as ready.
- [ ] Shutdown closes the server, watcher, and database without leaving the
      process hanging.

## Done when

- `mycel` in any TypeScript repository opens a dashboard showing that
  repository's live graph, and Ctrl+C shuts everything down cleanly.
- The installed package runs without the monorepo checkout.
