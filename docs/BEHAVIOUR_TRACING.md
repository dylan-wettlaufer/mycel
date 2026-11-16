# Evidence-backed behaviour tracing

## Representation and scope

The existing semantic schema is sufficient. `service_operation` records use a
`traceRole` attribute (`callable`, `ui_event`, `http_request`, `prisma_operation`,
or `unresolved`). Ordinary callable steps are not claims that every function is a
business service. Existing `endpoint`, `data_model`, CALLS, HANDLES, READS, WRITES,
provenance, source mappings, project identity, and atomic revision writes are
reused. No SQLite migration, structural graph changes, dashboard changes, agent
tracking, or runtime execution are needed.

Behaviour enrichment runs after feature discovery. It does not turn candidate
feature memberships or directory conventions into behaviour links. Existing
service roles and identities are reused; other functions get operations anchored
to their existing Tree-sitter function symbols. Inline callbacks likewise use
existing structural callback symbols. Each new relationship has deterministic
source evidence; this proves a static binding/reference, not that execution occurs.

## Event and function bindings

Intrinsic DOM `onClick` and `<form onSubmit>` bindings support named functions,
functions defined inside a component, directly bound arrows, const identifier
aliases, and inline arrows/function expressions. Only attributes in the supported
returned JSX are used. Event-binding CALLS edges mean potential invocation when
the event occurs, not invocation while rendering. Custom component event props
are unresolved because forwarding to a DOM event is not established. JSX spreads
and repeated event props are also unresolved rather than assuming a final handler.

Function bodies are inspected separately. Creating a callback does not execute
it. Direct lexical calls and imported namespace members use the existing binding
subset, with boundaries for reassigned or ambiguous bindings, type-only values,
unknown dispatch, and handler factories/wrappers. Passing a callback to an
arbitrary function does not establish callback execution. Direct event parameter
`preventDefault`/`stopPropagation` calls and unshadowed standard formatting/response
intrinsics do not represent onward application calls.

A boundary is a source-mapped operation with `traceRole=unresolved`, a machine
readable code, and a message. CALLS to it represent the observed unsupported call
site, not a fabricated target. Trace results will retain these boundaries.

## Native HTTP and Prisma adapter

A native unshadowed `fetch` creates a request step. Literal root-relative URLs,
including a query/fragment suffix, match exactly one same-package Next App Router
handler by pathname and literal method (default GET). The options must be a direct
object without spreads, shorthand or computed properties. Dynamic values,
external/relative URLs, encoded/dot paths, absent handlers, and non-exact/dynamic
route patterns produce explicit boundaries. No argument propagation through HTTP
wrappers, rewriting, middleware, cross-package deployment inference, or URL
interpolation is attempted.

Persistence support is the requested `prisma.<model>.<method>` client API with a
single-file schema and `prisma-client-js` generation into `@prisma/client`.
The receiver must resolve through imports/const aliases to a direct const
`new PrismaClient()` using that package's real imported constructor, not a local
module alias or reassigned binding. A captured model declaration must prove the
static delegate name. `findUnique`/`findMany` emit READS; `create`/`update`/`delete`
emit WRITES. Prisma promises must be directly awaited or returned; promises passed
to transaction/aggregation wrappers or saved for later consumption remain unresolved.
The operation call, client construction/import, and delegate access
are source-mapped. Model attributes preserve the captured Prisma declaration and
its schema path/range; Prisma metadata does not add structural nodes or require a
SQL schema change. The schema is read as data and never generated or executed.

Only one conventional `prisma/schema.prisma` or root `schema.prisma` is accepted.
Schemas/configuration are watched as metadata, so schema edits invalidate access
links in the same transaction as the semantic snapshot. Custom locations,
`prisma.config.*`, custom generated-client output, `prisma-client` generation,
singleton factories/extensions, dynamic delegates, unsupported CRUD, relation
includes/nested writes, transactions, and raw queries are unresolved. This is an
explicit initial adapter boundary, not a claim to support all Prisma generations.
Next Request body-decoding and Response/JSON intrinsics do not introduce application
call targets. Dynamic dispatch inside other libraries remains unresolved.

## Trace queries

- `GET /api/graph/behaviour/entries?limit=100` lists observed UI event bindings,
  including ones whose handler resolution stops at an explicit boundary. The
  `binding` attribute distinguishes resolved/unresolved bindings. Limit
  is 1–500. Every entry includes its event, element, and source mapping.
- `GET /api/graph/behaviour/:id?direction=forward&maxDepth=12&maxPaths=20`
  traverses supported call/event/request/access links. `direction=reverse` follows
  supported callers. A root can be an event, request, endpoint, callable operation,
  Prisma model, or an existing structural function ID returned by symbol search.
  A structural ID resolves to its callable operation in `rootId`.

Depth is 0–32 and counts relationship hops; paths are limited to 1–100. A query also
has a fixed 1,000-edge expansion budget. Reads are transactional and project-scoped.
Invalid/repeated parameters return 400; absent providers return 503; absent or
unsupported roots return 404. Core exposes `getBehaviourEntries` and
`traceBehaviour` on `createGraphQueries`, with matching database exports.

Responses contain the committed project/revision, root, direction, returned
entities, and terminal paths. Each path orders its entity IDs and hops, retaining
the original relationship with source/provenance. HANDLES is traversed endpoint →
handler forwards and handler → endpoint backwards; `fromId`/`toId` describe traversal
without rewriting the original stored relationship. No render, feature, directory,
or import-only relationship supplies a behavioural hop. CALLS uses the stricter
behaviour extractor's evidence, not older semantic hints.

Terminal reasons distinguish data access, unresolved boundaries (with code/message),
no supported calls/callers, cycles, depth limits, and work limits. `truncated` is
true if limits/cycles omit continuation or result paths. Multiple source call sites
to the same function can share an evidence-aggregating edge. Branches return
multiple reference paths, not a statement-by-statement execution order, argument
propagation, data-flow proof, exhaustive control-flow analysis, or a runtime log.
A query with no supported callers does not prove that a function is unused.


## Incremental coverage and unsupported protocols

The source-only fixture in `packages/core/test/fixtures/behaviour` is an ordinary
React form with state, a nested submission handler, a preview/submit HTTP client,
GET/POST Next handlers, a service module, and a real Prisma schema/client import.
Preview and submit produce separate read and write paths. It does not require a
Prisma runtime, database connection, or framework installation for extraction.

Watcher tests verify replacement of WRITES by READS after an operation edit,
removal/recovery of HTTP links after a dynamic URL edit, model invalidation on a
metadata-only schema rename without reparsing TS, configuration boundaries,
last-good-source retention through TS syntax errors, event-wrapper changes,
handler export removal, and entry deletion. Existing structural, semantic,
feature, persistence, and query tests remain in the checks.

Server Actions (`"use server"` directives on a function or module) are explicit
unsupported boundaries. Their bodies are not followed as ordinary client/server
calls or Prisma accesses. Axios/Hono adapters, Drizzle, better-sqlite3, class/object
method dispatch, arbitrary callback execution, HTTP wrapper parameter propagation,
Next route rewrites/base paths/dynamic pattern expansion, custom Prisma generation,
Prisma configuration execution, transactions, raw SQL, and nested relation access
remain outside this milestone. Trace requests report the supported prefix and the
boundary rather than joining layers by names, directory proximity, or feature hints.
