# Mycel product requirements

- **Release scope** V0
- **Product** Local-first, open-source developer tool
- **Initial language support** TypeScript and TSX

## Product vision

> Mycel helps developers understand what their AI agents are building and how it fits into the rest of their application.

Mycel is a living, visual representation of a software application's
architecture. It helps developers maintain a mental model of their application
as AI coding agents add features, change behavior, and refactor code. A
developer can know what they asked an agent to build and still need to see
where the implementation landed and which parts of the application it touches.

The architecture view should show recognizable areas such as Authentication,
User Management, Payments, and Orders alongside technical subsystems such as
backend API modules, database and persistence, and external integrations.
Developers can explore supported relationships and follow them down to
internal behavior and exact source.

The primary audience is developers who review and maintain applications built
with AI coding agents. Mycel also follows changes from manual edits because it
indexes the repository directly.

## Product principles

- **Architecture first, code second.** The default view shows meaningful
  features and architectural subsystems. The structural graph of files,
  functions, and dependencies supplies evidence and supports drilling down.
- **Progressive disclosure.** Follow **Application Architecture → Feature →
  Behavior / Internal Components → Source Code**. Preserve the selected area
  and navigation context when moving between levels or returning to the map.
- **Living architecture.** Automatically reflect source changes so that new
  features, changes to existing behavior, and refactors are visible as the
  application evolves.
- **Evidence-based understanding.** Ground relationships in source evidence.
  Distinguish observed structural facts, inferred or declared semantic
  classifications, and agent suggestions. Leave connections unsupported by
  the source unresolved.
- **Agent-assisted semantic understanding.** Accept context about what an
  agent is implementing to improve feature names, groupings, and
  classifications. Keep its provenance and independently validate reported
  source references and structural claims against the indexed code.

## Primary workflow

1. Run `mycel` in a TypeScript repository and open its application architecture.
2. Select **Orders** and see where it connects to **Payments** if source
   establishes that connection.
3. Explore a flow, such as submitting an order, through its UI entry point,
   API handler, and persistence operations wherever Mycel can trace them.
4. Open the exact source for a step or relationship, then return to the
   feature and architecture overview in the same context.
5. Let an agent or developer change the implementation. Mycel updates affected
   parts of the map and exposes the current evidence. Agent-proposed context
   can help explain the feature when available.

## Minimum V0 scope

### V0-01 — TypeScript structural analysis

Parse supported TypeScript and TSX. Extract files, functions, classes, imports,
exports, and supported calls. Resolve supported relationships across files
and persist a queryable structural graph.

**Acceptance.** Index a fixture with an imported function called from another
file. After reopening the index, a structural query can find the resolved
import and call and locate both declarations in source.

### V0-02 — Semantic feature representation

Represent application features, flows, and architectural subsystems. Associate
them with structural files or symbols and retain provenance and source evidence
for the mappings. Give features stable identities independent of implementation
file names. Support agent-proposed labels and groupings as semantic context.

**Acceptance.** A file move leaves the same logical feature addressable and
updates its source mapping. An agent-proposed grouping has visible provenance.
A proposal with an invalid reference or unsupported relationship cannot add a
verified relationship to the architecture.

### V0-03 — High-level architecture visualization

Open to a graph of meaningful application features and subsystems. Distinguish
features (application capabilities), flows (behaviors or sequences of steps),
and subsystems (technical areas that may serve several features). Show
supported relationships, with files and functions available through drill-down.

**Acceptance.** In a fixture with Orders, Payments, and persistence, the map
identifies each at the appropriate level. A supported connection can be traced
to underlying evidence. Sharing a label or a directory alone is insufficient
evidence for a connection.

### V0-04 — Progressive feature exploration

Select a feature from the map, explore its internal behaviors and components,
and follow their relationships to exact functions, files, and source locations.
Provide a path back to the architecture overview that preserves the selected
feature and navigation context.

**Acceptance.** Starting on the map, open Orders, follow a supported flow to
a handler's source range, and return to Orders and its place on the map.

### V0-05 — Automatic graph updates

Detect relevant source file changes, incrementally update the structural graph,
invalidate stale semantic mappings, and refresh affected feature
representations in the developer-facing interface.

**Acceptance.** With the architecture open, change or remove a supported
cross-feature call. After indexing commits the edit, the UI shows the updated
connection or removes the stale one, with source evidence from the committed
revision. The workflow works for ordinary file saves with or without agent
context.

## Architecture and scope boundaries

- Use a single local Node.js process for CLI startup, watching, indexing,
  SQLite, and Hono. The browser consumes project-scoped queries and live
  updates. Keep the parser and indexing engine independent of HTTP and the UI.
- Keep structural facts, semantic mappings, and presentation distinct.
  Archival source and the live graph use committed revisions so a view can
  show evidence from the same accepted source state.
- Bind to loopback, keep source processing local, and keep the index outside
  the tracked repository. Agent semantic context is optional input. The
  architecture view must work without agent-specific hooks.
- For small repositories, target visible updates within one second of a
  saved file. Measure detection, reindexing, persistence, and browser
  refresh separately.
- Change history, source diffs, and the file and symbol explorer support the
  architecture workflow. Agent session attribution, hosted sync, team
  collaboration, and additional languages are outside V0.

## Release validation

Use a small TypeScript application with several recognizable features and a
shared subsystem. Open Mycel, move from the map to a behavior and its source
and back, then apply an edit that adds or removes an evidenced relationship.
Verify the map updates, stale evidence disappears, and navigation stays
meaningful. Repeat with an agent proposal containing a valid source reference
and an unsupported relationship to check that each is handled independently.

See the [architecture guide](docs/ARCHITECTURE.md) for current implementation and
the V0 target, and [package task lists](docs/tasks/) for engineering work.
