# @mycel/parser

Fresh Tree-sitter extraction for TypeScript and TSX. This package takes source
text supplied by its caller. It does not discover/read source files, resolve
modules or calls, write to storage, or depend on the engine or HTTP server.
No implementation or fixtures were copied from Texo.

```ts
import { parseFile } from "@mycel/parser";

const result = parseFile(
  "src/save.ts",
  "export function save() { validate(); }",
);

result.symbols; // save, with an identity and source range
result.calls; // validate(), attributed to save; target resolution is left to core
result.exports; // named export: save
result.contains; // file contains save
```

## Contract

`parseFile(path, source)` is synchronous and selects TypeScript for `.ts`
(including `.d.ts`) or TSX for `.tsx`. Paths are caller-supplied identifiers:
the parser preserves them, performs no filesystem normalization, and never
reads the named source file. Core should supply consistent repository-relative
paths. Invalid argument types and unsupported extensions throw.

The result is plain serializable data:

- `symbols`: functions, classes, and methods, with names, lexical qualified
  names, parent IDs, ranges, static flags, and accessor/constructor metadata.
- `contains`: file-to-symbol and symbol-to-symbol containment.
- `imports`: module specifiers and default/named/namespace bindings, aliases,
  and both declaration-level and binding-level type-only flags. Side-effect
  imports have no bindings. Static `import x = require(...)` is also supported.
- `exports`: named/default exports, re-exports, star and namespace exports,
  destructured declaration names, and type-only distinctions.
- `calls`: call and constructor expressions, callee text/ranges, and the
  nearest callable ID. Calls in nested callbacks belong to the callback.
  Calls outside callable bodies have no caller ID. JSX elements are not calls.
- `diagnostics`: ranged syntax errors, missing tokens, and duplicate-symbol
  warnings. Syntax errors mark the result `partial`; recoverable facts remain.

Source ranges use **UTF-16 code-unit offsets**, one-based lines/columns, and an
exclusive end. Use `source.slice(range.start, range.end)`. These are not byte
offsets, and captured line endings are preserved. Shared range/diagnostic types
live in `@mycel/shared`.

Named symbol identities depend on the supplied path, kind, lexical qualified
name, static/accessor distinction, and duplicate ordinal. Unrelated line
shifts preserve IDs; renames and scope changes do not. Anonymous callbacks,
objects, classes, and block scopes use occurrence names, so inserting or
reordering those scopes can change IDs. Anonymous default exports use
`default`. These are file-local extraction identities; core owns project-level
graph identity and revisions.

Assigned arrows/function expressions produce one symbol for their binding.
Object methods and class arrow properties count as methods. Adjacent callable
overload signatures share a symbol and retain `signatureRanges` plus an
optional `implementationRange`. Other duplicate declarations stay separate
and produce warnings. Accessors and static/instance methods stay distinct.
Records follow deterministic syntax traversal order.

Interfaces, type aliases, ordinary variables, and object literals are not
symbols. Type/interface exports are still recorded. Dynamic imports and
ordinary `require()` calls remain call sites. CommonJS `module.exports` and
`export =` are not modeled as exports. Type inference, dependency resolution,
and actual runtime dispatch are outside this package.

## Dependencies and verification

The native Node binding provides a synchronous API with no WASM initialization
or grammar assets to locate. Both dependencies are pinned to a compatible
pair: `tree-sitter@0.21.1` and `tree-sitter-typescript@0.23.2`. Their native
install scripts are allowed by the root pnpm configuration. Only the parser's
`tsconfig` skips dependency declaration checking because the grammar package
ships an invalid ambient export assignment; Mycel source remains strictly
type-checked.

Every call performs a fresh parse. Bounded input reads avoid the native
binding's large-string buffer failure. Syntax trees stay internal and are
managed by the native binding's garbage collector; the package retains no
tree cache. Incremental reparsing can be added if engine measurements justify
the lifecycle complexity.

```sh
pnpm --filter @mycel/parser test
pnpm typecheck
pnpm lint
pnpm test
```
