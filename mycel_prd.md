# Mycel --- Product Requirements Document

**Version:** 1.0\
**Status:** Proposed\
**Product:** Local-first, open-source developer tool\
**Initial platform:** macOS, Linux, and Windows where Node.js and native
dependencies are supported\
**Primary command:** `mycel web`

## 1. Product overview

**Mycel** is a local-first tool for understanding how a codebase changes
while humans and AI coding agents work on it. Running `mycel web` inside
a repository launches a browser dashboard backed by an independently
maintained, continuously updated structural graph of the source code.

Mycel detects actual file and symbol changes, records their history, and
connects changes to source code and dependencies. Later, optional agent
adapters will associate changes with individual coding-agent sessions
when reliable evidence is available.

**Tagline:** See your codebase evolve.

### Core principle

**The repository is the source of truth.** Mycel derives structure and
changes from code; agents do not manually maintain the graph.
Agent-provided context and attribution are supplementary.

## 2. Problem and audience

AI coding agents can change repositories faster than developers can
maintain a mental model of them. With multiple agents running, users
must repeatedly inspect terminal output, agent conversations, source
files, and Git diffs to understand what happened.

**Primary user:** A developer actively building a TypeScript project
with one or more AI coding agents.

**Core job:** After a change, quickly answer: *What changed? Where is
it? What does it connect to?*

**Differentiator:** Continuous, code-derived change awareness rather
than a static diagram or an agent-maintained architecture document.

## 3. V1 scope and user workflow

### Included in core MVP (P0)

  -----------------------------------------------------------------------
  ID                      Requirement             Acceptance behavior
  ----------------------- ----------------------- -----------------------
  R1                      Local launch            `mycel web` run at a
                                                  repository root starts
                                                  a loopback-only server
                                                  and opens the
                                                  dashboard.

  R2                      Structural indexing     Parse TypeScript/TSX
                                                  files into file,
                                                  function, class, and
                                                  method nodes, with
                                                  resolved containment,
                                                  imports, and calls
                                                  where statically
                                                  determinable.

  R3                      Persistence             Store graph state,
                                                  diagnostics, and change
                                                  history in local
                                                  SQLite.

  R4                      Automatic updates       Detect source file
                                                  creation, modification,
                                                  deletion, and rename;
                                                  update affected graph
                                                  state without restart.

  R5                      Graph navigation        Search symbols and view
                                                  a bounded neighborhood,
                                                  callers, dependencies,
                                                  and source locations.

  R6                      Change highlighting     Distinguish created,
                                                  modified, and deleted
                                                  nodes/edges in the
                                                  activity/history views.

  R7                      Source and diff         Open source for a
                                                  selected node and
                                                  inspect before/after
                                                  changes using retained
                                                  history.

  R8                      Activity timeline       Persist chronological
                                                  events and stream new
                                                  events to the browser
                                                  over SSE.
  -----------------------------------------------------------------------

### Post-MVP (P1)

-   Capture agent session/tool metadata through supported adapters,
    beginning with Claude Code.
-   Associate observed changes with agents using **confirmed**,
    **inferred**, or **unknown** attribution.
-   Filter activity by agent and flag overlapping changes to the same
    file or symbol.

### Later (P2 / out of scope)

Historical session replay, MCP, LLM-generated explanations, hosted sync,
accounts, team collaboration, agent orchestration, multi-repo
workspaces, and languages beyond TypeScript/TSX.

### Primary workflow

1.  In a TypeScript repository, run `mycel web`.
2.  Mycel performs an initial index and opens the local dashboard.
3.  Search for a file/function and inspect its immediate relationships.
4.  Modify source code manually or using any coding agent.
5.  Mycel detects the change, updates the graph, persists events, and
    streams them to the UI.
6.  Select a changed node/event to inspect source, diff, and relevant
    relationships.

**The workflow must succeed without any agent-specific integration.**

## 4. Architecture and constraints

  -----------------------------------------------------------------------
  Layer                   Technology              Responsibility
  ----------------------- ----------------------- -----------------------
  CLI                     Node.js + TypeScript    Start/stop the local
                                                  application and resolve
                                                  repository root.

  HTTP server             Hono                    Serve built UI,
                                                  read-only query APIs,
                                                  and SSE.

  Frontend                Vite + React, Tailwind, Dashboard, activity,
                          shadcn/ui               graph, and explorer.

  Graph UI                React Flow              Bounded, interactive
                          (`@xyflow/react`)       node/edge
                                                  visualization.

  Parser                  Tree-sitter             Extract supported
                                                  source structure and
                                                  locations.

  Watcher                 Chokidar                Detect filesystem
                                                  changes.

  Persistence             SQLite +                Graph, diagnostics,
                          `better-sqlite3`        events,
                                                  snapshots/versioned
                                                  content.

  Editor                  Monaco                  Read-only source and
                                                  diff views.
  -----------------------------------------------------------------------

**Process model:** One local Node.js process owns the watcher,
parser/indexer, SQLite connection, and Hono server. The frontend is
prebuilt static assets served by Hono; Vite is used for frontend
development and building, not required at runtime.

**Indexing:** Initial full index followed by incremental updates.
Unresolved references remain unresolved; do not manufacture edges.
Stable IDs should not rely solely on line numbers. Index writes and
event writes must be transactional. Graph changes should be broadcast
only after persistence succeeds.

**History:** Store enough versioned source/snapshot data to reproduce
diffs; content hashes alone are insufficient. Keep a bounded or
configurable retention policy for later refinement.

**Security/privacy:** Bind to `127.0.0.1` by default, do not send source
to external services, constrain file-read API paths to the repository
root, and limit browser origins. Store application data outside the
tracked repository by default.

**Performance target:** For small repositories, target visible updates
within one second of a saved file. Measure separately the
file-detection, re-index, database, and browser-update stages; this is a
target, not a guaranteed SLA.

## 5. Data contracts

-   **Project:** Repository identity, absolute root, indexing settings.
-   **Node:** ID, project ID, kind, qualified name, path, source range,
    content hash, and revision.
-   **Edge:** ID, source node, target node, relation kind, and revision.
-   **Diagnostic:** File, location, parser/resolution error or warning.
-   **Change event:** Monotonic event ID, timestamp, entity, action,
    before/after revision references, and optional attribution.
-   **Session:** Monitoring start/end and starting graph revision.
-   **Agent session (post-MVP):** Provider, session ID, tool metadata,
    and observed attribution evidence.

**Graph relations:** `CONTAINS`, `IMPORTS`, `CALLS`, with `REFERENCES`
only when reliable resolution is implemented.

## 6. API contract

  -------------------------------------------------------------------------------------
  Method                  Route                                 Purpose
  ----------------------- ------------------------------------- -----------------------
  GET                     `/api/health`                         Process and index
                                                                status

  GET                     `/api/project`                        Current repository
                                                                metadata

  GET                     `/api/graph/search?q=`                Search files and
                                                                symbols

  GET                     `/api/graph/nodes/:id`                Node metadata

  GET                     `/api/graph/nodes/:id/neighborhood`   Bounded connected
                                                                subgraph

  GET                     `/api/files/content?path=`            Repository-contained
                                                                source content

  GET                     `/api/changes`                        Paginated change
                                                                history

  GET                     `/api/changes/:id/diff`               Historical source diff

  GET                     `/api/events`                         SSE updates with
                                                                reconnection cursor
  -------------------------------------------------------------------------------------

Use shared TypeScript types for backend responses and frontend
consumers. The server is the only component that reads SQLite or the
repository.

## 7. MVP completion criteria

The core MVP is complete when:

-   `mycel web` launches a working local dashboard.
-   A TypeScript/TSX repository indexes into queryable nodes and
    resolved relationships.
-   Users can search, navigate bounded neighborhoods, and open source
    locations.
-   File creation, modification, deletion, and rename update the graph
    without restart.
-   Changes persist across application restarts and appear in a live
    activity feed.
-   Selecting a change opens a correct before/after diff.
-   Parser errors, rapid writes, and reconnects do not corrupt state.
-   No coding-agent hook or cloud service is required.

**End-to-end test:** Start Mycel on a small TypeScript repository; have
Claude Code add a function and update its caller. Mycel must update both
relevant structural information and the activity feed, and allow
inspection of the source diff.

------------------------------------------------------------------------

# 8. Step-by-step implementation plan

The plan below preserves the seven milestones and their tasks from the
agreed implementation plan.

## Phase 1 --- Foundation and CLI

**Estimated: 1--2 days**

-   [ ] Audit existing Texo code and identify reusable parser, graph,
    and source-viewer components.
-   [ ] Create a pnpm monorepo with packages for cli, server, core,
    parser, db, and shared, plus apps/web.
-   [ ] Configure TypeScript, linting, formatting, and workspace
    imports.
-   [ ] Initialize Vite + React, Tailwind, shadcn/ui, and the Mycel
    theme.
-   [ ] Create a Hono server with GET /api/health.
-   [ ] Implement mycel web: resolve the current repository, start the
    server, and open the browser.
-   [ ] Serve compiled frontend assets from Hono for production CLI
    usage.

## Phase 2 --- Structural graph and SQLite

**Estimated: 3--5 days**

-   [ ] Reuse and adapt the existing Tree-sitter parser for TypeScript
    and TSX.
-   [ ] Extract files, functions, classes, methods, imports, calls, and
    source locations.
-   [ ] Define node and edge types with deterministic identifiers and
    content hashes.
-   [ ] Implement SQLite migrations and tables for projects, nodes,
    edges, and diagnostics.
-   [ ] Implement full-repository indexing with ignored directories and
    unsupported files excluded.
-   [ ] Implement getNode, searchSymbols, getNeighborhood, getCallers,
    and getDependencies.
-   [ ] Expose graph queries through Hono API endpoints.
-   [ ] Test extraction and resolution on small fixture repositories.

## Phase 3 --- Live incremental indexing

**Estimated: 3--5 days**

-   [ ] Add Chokidar to monitor source file additions, edits, deletions,
    and renames.
-   [ ] Debounce rapid file changes and skip unchanged content hashes.
-   [ ] Reparse only changed files and update their associated nodes.
-   [ ] Re-resolve relationships affected by changed imports, exports,
    or symbols.
-   [ ] Apply graph changes in SQLite transactions to prevent partial
    updates.
-   [ ] Handle parser failures while retaining the last known valid
    graph where appropriate.
-   [ ] Measure time from file save to completed graph update.

## Phase 4 --- Change history and live events

**Estimated: 3--4 days**

-   [ ] Define change event types for node and edge creation,
    modification, and deletion.
-   [ ] Compare previous and updated graph states to generate change
    events.
-   [ ] Persist events with timestamps, affected entities, and
    before/after references.
-   [ ] Store versioned source or snapshots sufficient to display
    historical diffs.
-   [ ] Introduce a local monitoring session with a starting graph
    revision.
-   [ ] Add an SSE endpoint that broadcasts committed changes to
    connected clients.
-   [ ] Implement event replay on reconnection using an event cursor.
-   [ ] Test chronological ordering, rapid changes, and reconnect
    behavior.

## Phase 5 --- Interactive browser dashboard

**Estimated: 5--8 days**

-   [ ] Build the application shell with a sidebar, project header, and
    connection status.
-   [ ] Create a searchable file and symbol explorer.
-   [ ] Integrate React Flow with scoped neighborhood queries and
    expand/collapse controls.
-   [ ] Add node details including type, location, callers,
    dependencies, and related files.
-   [ ] Implement a Monaco source viewer with navigation to symbol
    locations.
-   [ ] Add a Monaco diff view for recorded source changes.
-   [ ] Build a live activity feed and connect it to SSE.
-   [ ] Highlight recently created and modified nodes, and represent
    deleted nodes in history views.
-   [ ] Support navigation between activity events, graph nodes, and
    source code.
-   [ ] Test the full workflow while an external coding agent modifies a
    repository.

## Phase 6 --- Agent attribution --- post-MVP

**Estimated: 3--6 days**

-   [ ] Define an agent adapter interface independent of the graph
    indexer.
-   [ ] Implement a Claude Code adapter using supported session and tool
    hooks.
-   [ ] Capture available agent session IDs, tool events, timestamps,
    and affected paths.
-   [ ] Correlate agent events with observed file changes.
-   [ ] Record confirmed, inferred, or unknown attribution without
    forcing ambiguous assignments.
-   [ ] Display agent identities in the activity feed and provide agent
    filters.
-   [ ] Add Codex and Cursor adapters only after verifying their
    available integration mechanisms.
-   [ ] Test concurrent agents and overlapping file edits.

## Phase 7 --- Testing, packaging, and release

**Estimated: 3--5 days**

-   [ ] Add unit tests for parser output, graph queries, and change
    detection.
-   [ ] Add integration tests for watcher events, SQLite transactions,
    and SSE.
-   [ ] Test on a moderately sized real-world TypeScript repository.
-   [ ] Measure initial indexing, incremental indexing, query latency,
    and memory usage.
-   [ ] Handle shutdown, stale processes, unavailable ports, and
    database recovery.
-   [ ] Build the React frontend and bundle it with the CLI package.
-   [ ] Test installation and mycel web outside the monorepo.
-   [ ] Write README, architecture documentation, and a short demo
    walkthrough.
-   [ ] Publish an initial open-source release after confirming
    packaging and licensing requirements.

## 9. Proposed repository structure

``` text
mycel/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── components/
│       │   ├── features/
│       │   │   ├── graph/
│       │   │   ├── activity/
│       │   │   └── explorer/
│       │   └── lib/
│       └── vite.config.ts
│
├── packages/
│   ├── cli/
│   │   └── src/index.ts
│   ├── server/
│   │   └── src/
│   │       ├── app.ts
│   │       └── routes/
│   ├── core/
│   │   └── src/
│   │       ├── indexer.ts
│   │       ├── watcher.ts
│   │       ├── changes.ts
│   │       └── events.ts
│   ├── parser/
│   │   └── src/
│   ├── db/
│   │   └── src/
│   │       ├── schema.ts
│   │       ├── migrations/
│   │       └── queries.ts
│   ├── agents/
│   │   └── src/
│   └── shared/
│       └── src/types.ts
│
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

## 10. Development priorities

**MVP boundary:** Complete Phases 1--5 before working on agent
attribution.

Start by auditing the existing Texo parser and explorer. Reuse the
working parts rather than rewriting them. The first technical milestone
is an end-to-end path from file save → updated graph → persisted change
event → live browser update.

**Guiding principle:** Mycel observes the codebase independently. Coding
agents can supply attribution and context, but the actual source code
determines the graph.
