# Semantic application graph (phase 6.1)

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

The semantic layer enriches a captured graph; it does not alter structural symbol
identities, graph statistics, history events, or dashboard responses. There is no
agent tracking or AI explanation generation.

## Data model

| Entity kind | Meaning |
| --- | --- |
| `feature` | Explicitly declared application capability |
| `route` | Frontend URL pattern |
| `page` | Source implementation of a routable page |
| `component` | UI function containing JSX in its own implementation |
| `endpoint` | HTTP method and URL pattern with a source handler |
| `service_operation` | Explicitly designated application operation |
| `data_model` | Explicitly designated data declaration |
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
confidence in [0, 1]. Only deterministic rules are implemented in this milestone.
Confidence describes evidence strength, not runtime reachability or execution.

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
