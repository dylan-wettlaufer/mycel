# @mycel/core

Full-repository and incremental indexing, independent of the HTTP server and browser.
The current entry points are `discoverSourceFiles`, `indexRepository`,
`createGraphQueries`, `watchRepository`, and `openIndexedProject`.

```ts
import { openDatabase } from "@mycel/db";
import { indexRepository } from "@mycel/core";

const project = { name: "my-project", root: "/absolute/path/to/repository" };
const database = openDatabase({ projectRoot: project.root });
try {
  const result = await indexRepository({ project, database });
  console.log(result.fileCount, result.symbolCount, result.revision);
} finally {
  database.close();
}
```

Use `openDatabase({ databasePath: ":memory:" })` for a temporary index. The
caller owns the connection and coordinates index invocations. No repository
scripts/configuration are executed and Git is not required at runtime.

## Discovery and exclusions

`discoverSourceFiles(root, indexing?)` returns the canonical root and sorted,
repository-relative paths with forward slashes. `indexing` accepts partial
`IndexingSettings`; omitted settings default to:

```ts
{ extensions: [".ts", ".tsx"], exclude: [], respectGitignore: true }
```

- Supported files match the existing parser: `.ts` (including `.d.ts`) and
  `.tsx`. JavaScript, JSON, `.mts`, `.cts`, and other unsupported extensions
  are excluded. Configured extensions can narrow this set, not expand it.
- `.git`, `node_modules`, `dist`, `build`, `coverage`, `.pnpm-store`, and
  `.next` directories are pruned at every depth, even when Git ignores are
  disabled or a negation pattern would otherwise include them.
- Root and nested `.gitignore` files are interpreted relative to their own
  directories, with deeper rules taking precedence. Ignored directories are
  not traversed, so a child cannot be re-included without its parent. Rules
  match case-sensitively and apply regardless of whether a file is tracked.
  Global Git excludes, `.git/info/exclude`, and ignore files above the supplied
  root are outside this version's scope.
- `exclude` contains positive, repository-relative glob patterns, matched
  with dotfiles enabled. Examples: `**/*.test.ts`, `src/generated/**`, and
  `src/{fixtures,generated}/**`. These exclusions still apply when
  `respectGitignore` is false. Re-inclusion uses `.gitignore` rules, not this
  positive exclusion list.
- Symlinked files/directories and symlinked `.gitignore` files are skipped.
  Special filesystem entries and names containing a literal backslash are
  excluded. Root symlinks are canonicalized and share an index identity.

Directory rules are applied before traversal, so excluded dependency/build
trees are not read and filtered only afterward. Discovery works for ordinary
directories, untracked files, and saved working-tree edits.

## Indexing and persistence

`indexRepository({ project, database, indexing? })` discovers and captures the
selected source files, parses them, and builds:

- A file node for every included file, including empty/declaration files.
- Function, class, and method nodes from the existing parser.
- File/symbol `CONTAINS` edges with project-scoped endpoints.
- Ranged parser diagnostics, retaining recoverable structure from invalid
  source instead of discarding the whole repository.

Project IDs hash the canonical root. Node IDs hash the project ID and parser
identity (path, kind, lexical name, static/accessor distinction, duplicate
ordinal); they do not depend on source line numbers. Anonymous scopes retain
the parser's documented occurrence-based identity limits. Edge IDs hash their
project, kind, and endpoints. Hash inputs use JSON-encoded tuples to avoid
ambiguous separators.

Content hashes use SHA-256 of exact UTF-8 source: the full file or a symbol's
source range. UTF-8 decoding is strict and preserves BOMs and line endings.
Source ranges retain the parser's UTF-16 offset and one-based position units.

After capture/parsing succeeds, `@mycel/db.replaceProjectGraph` replaces that
project's metadata, nodes, edges, and diagnostics in one transaction, allocating
the next revision. Other projects and previous revision records remain intact.
Deleted files and files newly excluded by settings or ignore rules disappear
on the next full scan. A disk database must remain outside each indexed root,
including when its connection was originally opened for a different project.

The result contains project metadata, committed revision, indexed paths, file,
symbol, edge and diagnostic counts, and elapsed milliseconds. Each successful
full scan creates a revision, even if the source is unchanged. The connection
remains open for the caller to query or reuse.

Read/encoding/discovery errors and unexpected parser failures abort before
graph writes. Failed database writes roll back graph replacement, metadata,
and revision allocation together. Captured files form a scan of a changing
working tree, not an atomic filesystem snapshot.

## Indexed project lifecycle

`openIndexedProject({ project, databasePath?, indexing?, debounceMs?, onError? })`
opens storage, starts watching before the initial scan, and returns
`{ project, graph, flush, lastUpdate, close }` after reconciling startup saves.
Storage defaults to the per-repository database outside the source tree.
The returned `graph` is a project-scoped query facade ready to use. `close()`
releases storage and is safe to call more than once; indexing failures close
the connection before rejecting. Restarting reindexes the current source and
allocates a new revision in the existing database.

The CLI and standalone server use this lifecycle through `startIndexedServer`.
Startup waits for the initial index, then saved changes update graph queries
automatically. For temporary indexes, pass `databasePath: ":memory:"`.

## Graph queries

`createGraphQueries(database, projectId)` creates a `GraphQueries` facade for
one project's current graph. It exposes `searchSymbols({ q, limit? })`,
`getNodeDetails(id, { limit? }?)`, and
`getNeighborhood(id, { depth?, limit? }?)`, delegating to db without depending
on HTTP. Results use the shared `SearchResult`, `NodeDetails`, and `Neighborhood`
contracts. Unknown nodes return `undefined`. Node details include callers,
dependencies, related files, and file diagnostics in the same read transaction.
Limits and other database semantics are described in [db usage](../db/README.md).

The caller owns the database connection and keeps it open while using the
facade. The facade fixes the project ID and reads the latest committed graph
on each call. Pass it as `graph` to the server's `AppOptions`; see
[server usage](../server/README.md).

## Relationship resolution

Initial and incremental indexes resolve `IMPORTS` edges between local files and
`CALLS` edges for identifiable structural targets. Relative module resolution
supports `.ts`, `.tsx`, `.d.ts`, directory index files, and emitted `.js`/`.jsx`
specifiers. Named, default, namespace, aliased, and chained re-exports are
supported, with cycle guards and ambiguity checks. Type-only imports contribute
file dependencies but never runtime calls. Missing local modules produce
resolver diagnostics, which disappear when the module becomes available.

TypeScript `paths` and `baseUrl` are read from the nearest `tsconfig.json`,
including local `extends` files (JSONC) and referenced application configs. Local
workspace packages are discovered from npm/Yarn `workspaces` or
`pnpm-workspace.yaml` patterns. Package `exports` (including conditional and
wildcard subpaths), `main`, and type entries are resolved against indexed source.
Declared `rootDir`/`outDir`/`declarationDir` mappings and explicit package `source`
entries connect compiled entry points back to source before a build. External
dependencies are not indexed, and blocked exports remain unresolved.

Resolution uses TypeScript's module resolver with source/import conditions against
a captured virtual filesystem. It never executes Vite/Webpack configuration or
reads source outside the indexed repository. Bundler-only executable aliases and
external config-package inheritance are outside this scope. Malformed configs
produce `resolution-config` diagnostics.

Calls can resolve to lexical functions, imported functions/classes, namespace
members, static class methods, and `this` methods. Module-level calls originate
at the file node. This is structural resolution, not TypeScript semantic type
checking: dynamic imports, arbitrary receiver types,
and runtime binding/shadowing analysis are outside its scope. Unknown or
ambiguous targets produce no edge.

After a batch, relationships are recomputed from all cached parse facts. This
covers transitive re-exports, deleted targets, and previously missing modules
without reparsing consumers. SQLite reconciliation preserves unchanged nodes
and edges, including their last-written revisions. Dependency-directed resolver
invalidation can narrow this work later if measurements warrant it.

## Live updates and measurements

`watchRepository({ project, database, indexing?, debounceMs?, onError, parse? })`
provides the same live pipeline when the caller owns storage. Await `close()`
before closing that database. `openIndexedProject.close()` stops callbacks and
releases its owned storage synchronously. `flush()` processes queued changes
immediately and rejects on capture or database failure; background failures go
to `onError`. Failed batches retain their pending paths for a later save or
explicit flush, without advancing content hashes or cached parse facts.

Chokidar reports additions, edits, and deletions; renames are delete plus create.
Bursts are coalesced with a 75 ms trailing debounce by default. Discovery applies
the same exclusions as full scans and reconciles `.gitignore` changes. SHA-256
comparison skips identical saves before parsing. Only changed files are parsed;
relationship resolution uses cached facts for the complete project. Config,
workspace, and package manifest edits also trigger re-resolution without
reparsing unchanged source.

During live updates, partial parses retain a previous fully parsed file's nodes,
source hashes, and relationships, with current syntax diagnostics. Parser
exceptions retain any previous file and produce a `parser-failure` diagnostic.
Other files can still update. A new invalid file has no valid graph to retain:
recoverable partial structure is indexed, while a thrown parser produces only a
diagnostic. A later valid save replaces retained structure and clears parser
diagnostics; deletion removes both. The initial scan retains the full-index
behavior described above; last-valid parse caches live for the watcher session.

Every graph update reconciles nodes, edges, and diagnostics in one immediate
SQLite transaction. Unchanged records keep their revisions and diagnostic IDs.

`lastUpdate` is undefined before the first incremental commit, then exposes a
read-only `GraphUpdateTiming` with revision, changed/retained paths, monotonic
`observedAt`/`completedAt` timestamps, and milliseconds for queue/debounce,
capture/hash, parse, resolve, and database write. `latencyMs` measures the first
observed filesystem event through the completed commit, including debounce.
The OS does not expose the editor's exact save time: event delivery delay before
detection is outside this measurement. No-op saves and failed transactions do
not replace the last successful timing. Read it after `flush()` or after polling
the committed graph revision; it is exposed on both live entry points.

## Verify

```sh
pnpm --filter @mycel/core test
pnpm typecheck
pnpm lint
pnpm test
```

Fixtures cover nested ignore rules (checked against Git), custom globs,
unsupported/generated files, symlinks, TSX, partial syntax, UTF-16 ranges,
stable IDs, project isolation, rescans, persistence, and atomic failure cases.

The [import/call fixture](test/fixtures/import-call/README.md) checks a real
two-file repository through extraction, indexing, and query dependencies/callers
without manually seeded edges. Import and call resolution assertions pass as
regular acceptance tests.
