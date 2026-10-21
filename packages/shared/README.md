# @mycel/shared

Dependency-free TypeScript contracts shared by the engine, storage, HTTP server,
CLI, parser, and browser. All public exports are types; importing this package
does not load Node APIs, Tree-sitter, SQLite, or HTTP code.

## Project and graph contracts

- `ProjectInfo`: the existing `{ name, root }` launch metadata. `root` is an
  absolute path. This shape remains valid before engine initialization.
- `Project`: adds a persistent `id` and `IndexingSettings` to launch metadata.
  Settings select `.ts`/`.tsx` extensions, repository-relative exclude globs,
  and whether to honor `.gitignore`. `.ts` includes declaration files.
- `GraphNode`: project and node IDs, kind, name, lexical qualified name,
  repository-relative path, source range, content hash, and last-written
  revision. `NodeKind` is `file | function | class | method`; `SymbolKind`
  excludes files and is also used by the parser.
- `GraphEdge`: project ID, edge ID, source/target IDs, relation kind, and
  last-written revision. Both endpoints must exist in the same project.
  `CONTAINS` runs parent to child, `IMPORTS` importing file to dependency,
  and `CALLS` caller to callee. Module-level calls can originate at file nodes.
  Unresolved references remain diagnostics/facts, rather than dangling edges.
  `REFERENCES` is reserved and is not an accepted `EdgeKind` yet.
- `SourceRange` and `Diagnostic`: the existing parser-compatible contracts.
  Ranges use UTF-16 offsets with exclusive ends and one-based lines/columns.

IDs are opaque strings on the wire, including when storage uses numeric row
keys internally. Core owns project identity, path canonicalization, and
deterministic node/edge ID generation. Moving a named declaration down a file
should preserve its identity; renaming or changing lexical scope may change it.
Project identity should not depend on the repository's mutable display name.

`ContentHash` represents a lowercase hexadecimal SHA-256 digest. Hash exact
source encoded as UTF-8, without whitespace/line-ending normalization: the
entire source for file nodes, and the node's source range for symbol nodes.
It describes content, not identity or historical source. Core computes hashes;
this package contains no hashing implementation.

`Revision` is a nonnegative safe integer scoped to one project. Revision zero
represents an empty graph. A committed change set increments the project
revision; unchanged records can retain older last-written revisions.

These are TypeScript contracts, not runtime validators. Numeric bounds, hash
format, path containment, project consistency, and graph integrity must be
checked at their owning boundaries in core, db, or server.

## Query contracts

`SearchQuery`, `NeighborhoodQuery`, `NodeDetailsQuery`, and `FileContentQuery`
describe application query options after HTTP parsing. Numeric options must
still be validated and capped by the server; they are not raw URL strings.

All successful graph query responses include `projectId` and `revision`,
identifying the committed graph snapshot used to answer the request:

- `SearchResult`: matching nodes with a `truncated` flag.
- `NodeDetails`: the selected node, bounded lists of callers, dependencies,
  and related file nodes, plus diagnostics. Each list has its own `truncated`
  flag, so the UI can distinguish an empty result from an incomplete result.
- `Neighborhood`: root ID, nodes, edges, and `truncated`. The root must be
  included, and every returned edge endpoint must appear in the node list.
  Depth bounds the requested traversal; `truncated` reports size-limit cuts.
- `FileContent`: path, source language, captured source, and its hash. Content
  must match the response snapshot/hash rather than mixing live file edits
  with ranges from an older index.
- `GraphStats`: file, symbol, edge, and diagnostic counts for one project.

`ErrorResponse` retains the existing `{ error: string }` JSON error shape.
These definitions do not add API routes or database/query implementations.

## Health compatibility

`HealthResponse.status` remains `"ok"` for process liveness. Optional `index`
contains status (`idle | indexing | ready | error`), indexed-file count, total
file count (null before discovery finishes), and an optional message. Optional
`database` is `closed | ready | error`. An indexing error does not by itself
mean the HTTP process is unreachable.

The server currently returns liveness only; the CLI still supplies minimal
`ProjectInfo`. Core/server integration will populate the richer fields. The
existing browser fetch helpers also continue consuming just those minimal
fields until that integration is implemented.

## Verify

```sh
pnpm --filter @mycel/shared test
pnpm typecheck
pnpm test
```

The shared test script builds the public declarations and compiles consumer
fixtures against the package entry point, including expected failures for
invalid contracts. It runs without a runtime test framework or Node type
dependencies. Phase 4 history/event and post-MVP attribution contracts remain
separate work.
