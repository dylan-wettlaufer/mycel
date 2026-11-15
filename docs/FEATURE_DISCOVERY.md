# Automatic feature discovery (phase 6.2A)

## Audit and design

Phase 6.1 already resolves lexical JSX references, direct calls to recognized
operations, HTTP handler exports, and external imports. It stores project-scoped
semantic records with provenance and source anchors in the structural transaction.
Its missing inputs for automatic discovery were layouts and ordinary service
functions; `@mycelFeature` was the only feature producer.

Discovery is an enrichment pass over this same graph. There is no new parser,
separate feature graph, LLM dependency, dashboard change, or agent tracking.
Existing semantic tables already accept heuristic provenance and string-valued
attributes, so this milestone needs no schema migration.

## Inputs

Next App Router `layout.tsx` defaults become components when not already recognized
by the JSX extractor. Anonymous defaults and layouts returning `children` are
included. Layout applicability is a framework convention; it does not establish
that a layout actually renders its children, so no implicit RENDERS edge is added.

A directly called, exported function in a `services/` directory becomes a candidate
`service_operation`, with heuristic provenance and confidence 0.65. The call target
must resolve through the existing lexical-binding subset. Candidate service calls
can reach other exported services, with cycle detection. Unused functions,
unresolved imports, nested callback execution, arbitrary directory functions, and
runtime object dispatch are excluded. Explicit roles keep their existing identity
and deterministic provenance. A service candidate has `attributes.status` equal to
`candidate`; its lexical CALLS edges describe static binding, not a verified
business role.

Feature annotations run after role extraction, so a plain service can use
`@mycelFeature` without also needing `@mycelService`.

## Discovery rules

- A supported frontend route seeds a candidate from its first static public path
  segment (0.8 confidence). Nested and parameterized routes share that area.
- Root or dynamic-only pages can use the innermost named route group (0.6).
  Group names are organizational evidence, not verified application behavior.
- A named `features/<name>/` directory seeds a candidate only when it contains
  recognized UI or service entities (0.65). Generic shared/common/UI/utility
  directories are excluded. A directory association is never a runtime edge.
- Candidates with the same name in one owning package share an identity. An
  existing explicitly declared feature with that name is reused; its declaration
  remains authoritative and inferred associations remain heuristic.
- A page's explicit feature assignments supply its route's feature instead of
  generating a differently named route candidate. Explicit assignments on any
  declaration suppress conflicting automatic memberships for all its semantic
  roles. Propagation stops at a conflicting explicit assignment.
- Applicable ancestor layouts are associated by the supported App Router
  convention (at most 0.7). Common layouts can belong to multiple features.
- Forward deterministic RENDERS/CALLS/HANDLES links supply additional memberships,
  for at most eight hops, without following imports or reverse caller edges.
  Propagated confidence starts at most 0.65 and decreases by 10% per hop. Cycles
  are visited once per seed. Shared dependencies retain every supported membership.

Every inferred association has heuristic provenance, a rule, confidence, and
source evidence for its seed and the source references supporting its path.
Confidence values are policy weights for evidence strength, not calibrated
probabilities or proof of runtime execution. Features have `attributes.status`
`candidate` or `declared`; explicit feature declarations remain deterministic.
