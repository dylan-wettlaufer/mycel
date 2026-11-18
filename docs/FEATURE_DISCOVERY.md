# Automatic feature discovery

Discovery groups supported code into candidate application areas. It enriches
the [semantic graph](SEMANTIC_GRAPH.md) with heuristic provenance and source
anchors, and the current **Features** view labels these candidates **Inferred**.
The [V0 architecture map](../mycel_prd.md#v0-03--high-level-architecture-visualization)
will use semantic representations of features, flows, and subsystems. The
rules below describe the current feature candidates and their memberships.

## Inputs

Next App Router `layout.tsx` defaults become components when not already recognized
by the JSX extractor. Anonymous default function declarations and layouts returning `children` are
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


## Queries

- `GET /api/graph/semantic/features?status=candidate&limit=100` lists candidates.
  Use `status=declared` for explicit features or omit status for both. Results
  contain source mappings, attributes, provenance, the project revision, and a
  truncation flag. Legacy deterministic feature records without a status attribute
  are treated as declarations for filtering.
- `GET /api/graph/semantic/features/:id?limit=100` returns the feature and its direct
  associated entities with all returned IMPLEMENTS evidence. It omits unrelated
  runtime edges. The limit includes the feature itself, so limit 1 returns only
  that entity and reports truncation if it has members.

Both limits are 1–500. Invalid or repeated parameters return 400; unavailable
providers return 503; an unknown or non-feature detail ID returns 404. Reads are
project-scoped and transactional. Shared entities can occur in several feature
responses. `createGraphQueries` exposes `getFeatures` and `getFeature`;
`@mycel/db` exposes `getSemanticFeatures` and `getSemanticFeature`. Existing semantic
snapshot and neighborhood queries also include the new candidates and memberships.

The dashboard's **Features** view uses
`GET /api/graph/semantic/features/:id/behaviour` to read membership and up to
eight UI event traces in one project revision. It matches events to page or
component declarations by structural symbol ID. The membership `limit` follows
the detail endpoint, and the response reports truncation when membership, event,
or trace limits omit results.

## Incremental behavior and limits

Discovery runs on the captured semantic snapshot, after declaration extraction and
lexical references. The existing structural/semantic transaction replaces stale
records atomically. Candidate identities depend on project, owning package, and
area name; line shifts keep identity, while a feature rename changes it. When
several seeds corroborate a candidate, its primary provenance retains the strongest
rule and confidence while its sources retain the supporting evidence. Promoting
a candidate to an explicit declaration uses the existing explicit identity and
removes the candidate. A source move updates every affected source mapping and
relationship. Existing last-good-source retention applies on syntax errors.
V0 requires [logical feature identity](../mycel_prd.md#v0-02--semantic-feature-representation)
to survive implementation file moves even when discovery hints change. Today
the candidate remains addressable as long as its owning package and area name
remain the same.

Route area names and feature directory names are hints, not product requirements.
A broad area such as `settings` may contain several real features. Route groups can
reflect teams or visual organization. Unused directory components can still form
organizational candidates, with no claimed runtime path. The implementation does
not identify arbitrary service classes, infer ownership from import edges, match
fetch URLs to handlers, follow callbacks or dynamic dispatch, or infer READS/WRITES. [Behaviour tracing](BEHAVIOUR_TRACING.md) adds separately
verified Prisma access links; feature memberships are never used as behavioural hops.
Only the existing React/TSX subset and default Next App Router conventions are
supported. No exclusivity, user-visible feature completeness, or runtime behavior
is implied by membership.

`packages/core/test/fixtures/feature-discovery` is unannotated. Its fixture tests
cover route areas and nested routes, group-root pages, applicable/shared layouts,
named feature directories, shared components/services, explicit override variants,
source evidence, query integration, source moves, reference removal, feature/group
renames, route deletion, and promotion/demotion through annotation edits.
