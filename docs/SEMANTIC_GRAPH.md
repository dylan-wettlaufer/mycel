# Semantic application graph

The semantic graph connects application concepts to the files and symbols that
implement them. It is the evidence layer behind the current Features view and
the foundation for the [V0 architecture map](../mycel_prd.md#v0-03--high-level-architecture-visualization).
[Feature discovery](FEATURE_DISCOVERY.md) identifies candidate areas and their
members. [Behavior tracing](BEHAVIOUR_TRACING.md) follows supported event,
HTTP, and Prisma paths using the same persistence model.

## Audit and integration

- `@mycel/parser` uses Tree-sitter to capture lexical functions/classes/methods,
  imports/exports, call sites, and UTF-16 source ranges. Its AST does not escape
  `parseFile`. The existing React fixture covers JSX but has no routing framework.
- `@mycel/core` captures source before writes, builds structural nodes, and resolves
  imports/calls. Live indexing reparses changed files, retains the last good source
  on syntax failure, and rebuilds relationships against all captured files.
- `@mycel/db` stores current structural nodes/edges with project-scoped foreign keys.
  Full indexing replaces a project graph; monitoring reconciles it inside the same
  transaction as source snapshots and structural history events.
- `GraphQueries` binds reads to one project. `/api/graph` exposes bounded structural
  queries used by React Flow. Semantic queries are additive and use separate types.

Semantic records enrich a captured graph and live alongside structural nodes
and events. The browser uses semantic queries for feature discovery and
drill-down, while structural queries provide file and symbol navigation.

## Data model

| Entity kind | Meaning |
| --- | --- |
| `feature` | Explicitly declared capability or heuristic organizational candidate |
| `route` | Frontend URL pattern |
| `page` | Source implementation of a routable page |
| `component` | UI function containing JSX in its own implementation |
| `endpoint` | HTTP method and URL pattern with a source handler |
| `service_operation` | Explicitly designated application operation |
| `data_model` | Explicit declaration or verified Prisma schema model |
| `external_dependency` | Imported external module specifier |

Relationships are directed: `RENDERS` (route/page/component → rendered UI),
`HANDLES` (operation → endpoint), `CALLS` (caller → operation), `READS`/`WRITES`
(operation → data model), `IMPLEMENTS` (implementation → feature), and `DEPENDS_ON`
(consumer → dependency). A kind's availability in the contract does not mean an
extractor can establish it. In particular, imports and type references do not
establish data access, and file names do not establish application features.

Each entity and relationship carries one or more source mappings to an existing
structural file or symbol node, a repository-relative path, and a source range.
Identity is project-scoped and independent of line offsets. Provenance records
`deterministic`, `heuristic`, or `ai`, extractor identifier, version, rule, and
confidence in [0, 1]. Current extractors use deterministic source rules and
heuristic discovery. Confidence measures the strength of the supporting evidence
for a static claim.

The [V0 semantic design](ARCHITECTURE.md#semantic-mappings) extends this
foundation to distinguish features, flows, and subsystems, and keeps logical
feature identity independent of implementation paths. The
[agent proposal design](ARCHITECTURE.md#agent-proposed-context-v0-target) records
the origin of suggestions and validates their source references and relationship
claims independently. Proposal ingestion is planned V0 work.

Migration 003 adds `semantic_entities`, `semantic_relationships`, and
`semantic_sources`. Sources have exactly one semantic owner and a same-project
structural anchor; endpoints have same-project foreign keys. Revision references
use the existing revisions table. Writes replace the semantic snapshot inside the
structural commit so deletion, re-resolution, and rollback remain atomic. The
optional semantic payload on `ProjectGraph` keeps existing graph producers valid;
omitting it clears obsolete semantic enrichment.

Current-state queries return bounded snapshots and neighborhoods (both directions,
0–5 hops, up to 500 entities), including only relationships whose endpoints are
returned. Each response identifies its project and structural snapshot revision.
Semantic history is outside this milestone.

## Query API

- `GET /api/graph/semantic?limit=100`: current semantic snapshot, sorted by identity.
- `GET /api/graph/semantic/:id/neighborhood?depth=1&limit=100`: bounded traversal.

Limits are 1–500 and depth is 0–5. Missing entities return 404; unavailable query
providers return 503. The project is bound by the server, not chosen by request
parameters. Truncation describes omitted entities; only induced relationships are
returned. The same methods are available on `createGraphQueries`, and the database
package exports `getSemanticGraph` and `getSemanticNeighborhood`.

## Extraction pipeline

`extractSemanticGraph` runs composable semantic extractors over captured text and
structural nodes. Extractors receive a read-only-by-convention context, including
source ASTs, lexical bindings, module resolution, and structural source anchors.
They return entities and relationships; duplicate identities fail explicitly. A
reference pass binds declarations after extraction. Custom extractors can be
supplied through the public core API. The standard indexer runs the default set.

The existing TypeScript dependency provides a second, semantic binding pass over
captured sources only. Its compiler host cannot read disk, load dependencies, or
execute project configuration. Tree-sitter continues to own the structural parse
and graph. Partial parses are excluded from new semantic extraction; live indexing
continues to retain the previous good captured source on parse failure.

React extraction supports named function declarations and directly bound arrow or
function expressions in TSX with an uppercase name and a direct JSX return
(including parenthesized and conditional JSX). JSX aliases and reexports resolve
to captured functions. Shadowed imports remain separate bindings. Returned nested
closures, runtime object dispatch, higher-order component wrappers, and JSX that
is not part of a returned expression stay unknown. `RENDERS` records a source-level
JSX reference, not a guarantee about runtime rendering or reachability.

External dependency entities represent exact runtime import specifiers, including
package subpaths. They do not claim an installed package/version. A `DEPENDS_ON`
edge requires a direct imported call or JSX use within a recognized implementation.
Type-only imports, unresolved local aliases, and unused imported bindings do not
produce runtime relationships. Nested callback execution is not assumed.

## Supported Next.js and explicit declarations

The first framework adapter supports the default Next.js App Router conventions.
The nearest containing package must declare `next` as a dependency, development,
peer, or optional dependency. A nested package without Next does not inherit this
classification. Root `app/` takes precedence over `src/app/` within that package.
Metadata changes re-evaluate this support using the existing module resolver.

- `page.tsx` with a directly resolvable local default function exports a `page`
  entity and a frontend `route`; the route `RENDERS` that page.
- `route.ts` with a directly resolvable local `GET`, `POST`, `PUT`, `PATCH`,
  `DELETE`, `HEAD`, or `OPTIONS` export establishes an `endpoint` and its handler
  `service_operation`. The operation `HANDLES` the endpoint. Direct calls from
  either implementation role can point to explicitly designated operations.
- Normal ASCII path segments, `(groups)`, `[parameters]`, `[...catchAll]`, and
  `[[...optionalCatchAll]]` are supported. Patterns retain bracket notation;
  route groups are removed from the public pattern.
- Private folders, parallel slots, intercepted routes, conflicting public paths,
  reexported handlers/pages, class components, higher-order wrappers, and custom
  `pageExtensions` or routing configuration are outside this subset. No endpoints
  are synthesized for implicit methods. The route adapter itself does not infer
  fetch-to-API links; [behaviour tracing](BEHAVIOUR_TRACING.md) adds literal same-app matching. It
  does not infer runtime layout composition, client/server boundaries, or database behavior.
  Layout defaults are recognized as components for heuristic feature association.

Explicit features and roles can be declared with JSDoc tags. Automatic feature
candidates and called `services/` operations are also supported as described in
[feature discovery](FEATURE_DISCOVERY.md). Other data models still require tags;
the Prisma adapter also verifies model declarations from captured schemas:

```ts
/**
 * @mycelService
 * @mycelFeature orders
 */
export function listOrders() { /* implementation */ }

/** @mycelModel */
export interface Order { id: string }
```

`@mycelService` takes no argument and applies to a supported function declaration
or directly bound arrow/function expression. `@mycelModel` takes no argument and
applies to a top-level class, interface, or type alias. Merged/duplicate model
names remain unknown. Models without structural symbol kinds map to their file
node and exact declaration range. No synthetic structural symbols are created.

`@mycelFeature <name>` declares a project-scoped feature. Names contain letters,
digits, `_`, `.`, `/`, or `-`, starting with a letter or digit. A tag on a recognized
component, page, operation, or model also establishes `IMPLEMENTS`. Multiple
source declarations of the same feature aggregate their source evidence. Tags
express author declarations; extraction does not evaluate whether they are true.
`READS` and `WRITES` are emitted only for verified supported Prisma operations by
[behaviour tracing](BEHAVIOUR_TRACING.md); imports and return types alone do not
establish data access. [Feature discovery](FEATURE_DISCOVERY.md) adds heuristic
records alongside source declarations.

Direct semantic calls resolve only to recognized operations. The binding pass
omits ambiguous star-export chains, type-only value references, overloaded or
merged targets, unknown dispatch, and unsupported aliases. Invalid ambiguous
modules and consumers are conservatively excluded from binding-based relations.
General TypeScript type errors are not turned into new structural diagnostics.

## Fixture and validation

`packages/core/test/fixtures/semantic-next` contains a small source-only orders
application with a manifest, a path alias, a grouped page route, a React component,
an annotated operation, an interface model, an HTTP handler, and an SDK import.
The `.txt` suffix keeps fixture sources out of Mycel's own source discovery. Tests
materialize the app in a temporary repository; installing or running Next is not
required.

The queryable frontend path is:

```text
route /orders --RENDERS--> page OrdersPage --RENDERS--> component OrdersPanel
  --CALLS--> service_operation listOrders --DEPENDS_ON--> orders-sdk/client
```

The handler operation `GET` `HANDLES` `GET /api/orders`, `CALLS` `listOrders`,
and the explicitly tagged implementations `IMPLEMENT` feature `orders`.
Tests check exact JSX evidence, all structural source anchors, identity stability,
annotation handling, framework boundaries, query limits, atomic schema upgrade and
rollback, incremental export/annotation edits, deletion, metadata invalidation, and
last-good-source retention after syntax errors. Existing structural graph tests
continue to run unchanged apart from the additive schema table inventory.
