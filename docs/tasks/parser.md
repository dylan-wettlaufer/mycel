# `@mycel/parser` tasks

Turns TypeScript and TSX source text into structural facts: symbols, their
locations, imports, exports, and call sites. The parser is pure. It does not read
the file system, touch SQLite, or know about the server. Cross-file resolution
happens in `@mycel/core`.

See [architecture](../ARCHITECTURE.md#change-pipeline-planned).

## Current state

- Empty scaffold (`src/index.ts`).

## Tasks

### Phase 1: decisions

- [ ] Locate the existing Texo parser and decide what to reuse (see open
      decision 1 in the architecture document).
- [ ] Choose a binding: native `tree-sitter` with `tree-sitter-typescript`, or
      `web-tree-sitter` with WASM grammars. Record the decision and the reason.
- [ ] If native, add the packages to `pnpm.onlyBuiltDependencies` in the root
      `package.json` and confirm install on macOS, Linux, and Windows.

### Phase 2: extraction

- [ ] Expose a single entry point, for example
      `parseFile(path, source): ParseResult`, choosing the TypeScript or TSX
      grammar by extension.
- [ ] Extract top-level and nested functions, including arrow functions and
      function expressions assigned to `const`.
- [ ] Extract classes and their methods, including getters, setters, and
      static methods.
- [ ] Compute qualified names (for example `GraphStore.upsertNode`) and a
      source range for each symbol.
- [ ] Extract import declarations: specifier, named, default, and namespace
      imports, and type-only imports flagged separately.
- [ ] Extract exports: named, default, and re-exports (`export * from`,
      `export { a } from`).
- [ ] Extract call sites with the callee expression text and the enclosing
      symbol, leaving resolution to core.
- [ ] Report syntax errors as diagnostics with ranges. Still return whatever
      structure was recoverable.
- [ ] Return containment (file contains class contains method) directly in the
      result.

### Phase 3: incremental support

- [ ] Keep parsing a single file fast enough for the one-second update target.
      Measure parse time on a large fixture file.
- [ ] Optionally support Tree-sitter incremental reparse with a previous tree
      if measurements show it is needed.

## Tests

- [ ] Fixture files covering each symbol kind, import and export form, and
      call shape.
- [ ] Snapshot or explicit assertions on `ParseResult` for each fixture.
- [ ] Files with syntax errors produce diagnostics and partial results without
      throwing.
- [ ] TSX components and JSX do not break extraction.

## Done when

- `parseFile` returns stable, deterministic results for the fixture set.
- Malformed input never throws; it produces diagnostics.
- The package has no dependency on `db`, `core`, or `server`.

## Open questions

- Should anonymous default-exported functions get a synthetic name such as
  `default`?
- Should object-literal methods and class property arrow functions count as
  methods in the first version?
