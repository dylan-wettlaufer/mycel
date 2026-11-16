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
