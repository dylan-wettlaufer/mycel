# `@mycel/parser` tasks

Turns TypeScript and TSX source text into structural facts: symbols, their
locations, imports, exports, and call sites. The parser does not read source
files, touch SQLite, or know about the server. Cross-file resolution belongs
to `@mycel/core`.

See [package usage and contracts](../../packages/parser/README.md) and
[architecture](../ARCHITECTURE.md#change-pipeline-planned).

## Current state

- Fresh Tree-sitter implementation; no Texo code or fixtures reused.
- Native `tree-sitter@0.21.1` and `tree-sitter-typescript@0.23.2`, pinned to
  satisfy the grammar package's binding peer dependency. Native bindings keep
  a synchronous Node API without WASM initialization or asset loading.
- `parseFile(path, source)` selects the `.ts` or `.tsx` grammar and returns
  serializable structural facts. Parsing recovers from syntax errors.

## Tasks

### Phase 1: decisions

- [x] Implement from scratch rather than porting Texo, per the revised scope.
- [x] Choose and document the native binding and separate TS/TSX grammars.
- [x] Allow required native dependency builds in `pnpm.onlyBuiltDependencies`.
- [ ] Confirm installation and parser tests on Linux and Windows. Verified
      locally on macOS with Node 26.9.0.

### Phase 2: extraction

- [x] Expose `parseFile(path, source): ParseResult`.
- [x] Extract top-level/nested functions, assigned arrows/function expressions,
      generators, and anonymous callbacks.
- [x] Extract classes, constructors, methods, accessors, and static methods.
- [x] Include object methods and class property arrows as methods.
- [x] Compute lexical qualified names, deterministic local identities,
      containment, and source ranges.
- [x] Group adjacent overload signatures with their implementation.
- [x] Extract default, named, namespace, side-effect, and type-only imports.
- [x] Extract named/default exports, declaration exports, and re-exports.
- [x] Record call/constructor sites with callee text, ranges, and the nearest
      callable; leave targets unresolved.
- [x] Report error nodes and missing tokens with ranges and partial results.
- [x] Name anonymous default-exported callables/classes `default`.

### Phase 3: performance

- [x] Measure a generated 130,889-byte file with 2,000 functions and calls:
      approximately 183–185 ms for full parse and extraction on the local
      development machine. This is a parser measurement, not an end-to-end
      update-latency guarantee.
- [x] Use bounded input reads and test large files against truncation/failure.
- [ ] Add incremental reparse only if indexing measurements show it is needed.
      The current API performs a fresh parse and retains no trees.

## Tests

- [x] Fresh fixtures for symbols, module declarations, and TSX components.
- [x] Explicit assertions for extraction, containment, overloads, and callers.
- [x] Determinism, identities across line shifts, and duplicate scopes.
- [x] UTF-16 offsets, Unicode columns, CRLF, and exclusive end positions.
- [x] Invalid TS/TSX and missing tokens produce ranged diagnostics.
- [x] Large-file regression coverage.

## Remaining boundaries

- Supported file extensions are `.ts` (including `.d.ts`) and `.tsx`.
- Interfaces, type aliases, ordinary variables, and objects are not graph
  symbols. Their named exports are still recorded.
- Dynamic imports and ordinary `require()` expressions are call sites; they
  are not resolved module dependencies. Static `import x = require(...)` is
  recorded as an import.
- No semantic type checking or cross-file module/call resolution.
- Invalid caller arguments and unsupported extensions throw explicitly;
  malformed source for a supported language returns diagnostics.
