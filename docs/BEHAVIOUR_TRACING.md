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
are unresolved because forwarding to a DOM event is not established.

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
emit WRITES. The operation call, client construction/import, and delegate access
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
