# `@mycel/shared` tasks

Shared types and API contracts used by every backend package and the browser.
It must stay dependency-free and browser-safe: no Node.js imports, no runtime
code beyond small pure helpers.

See [architecture](../ARCHITECTURE.md#data-model-planned) for the data model.

## Current state

- `HealthResponse` (`{ status: "ok" }`) and `ProjectInfo` (`{ name, root }`)
  in `src/types.ts`.
- Browser-safe `SourceRange` and `Diagnostic` contracts used by the parser.

## Tasks

### Phase 2: graph contracts

- [ ] Define `NodeKind` (`file`, `function`, `class`, `method`) and
      `EdgeKind` (`CONTAINS`, `IMPORTS`, `CALLS`; reserve `REFERENCES`).
- [x] Define `SourceRange` with one-based line/column positions and exclusive
      UTF-16 offsets, matching source slicing in JavaScript.
- [ ] Define `GraphNode`: id, project id, kind, name, qualified name, path,
      range, content hash, revision.
- [ ] Define `GraphEdge`: id, source id, target id, kind, revision.
- [x] Define `Diagnostic`: path, range, severity, source (`parser` or
      `resolver`), message.
- [ ] Extend `ProjectInfo` or add `Project` with id and indexing settings.
- [ ] Define API response types: `SearchResult`, `NodeDetails` (node plus
      callers, dependencies, related files), `Neighborhood` (nodes, edges,
      truncation flag), `FileContent`.
- [ ] Extend `HealthResponse` with index status (`idle`, `indexing`, `ready`,
      `error`), indexed file count, and database status.

### Phase 4: change history contracts

- [ ] Define `ChangeAction` (`created`, `modified`, `deleted`) and
      `ChangeEvent`: monotonic id, timestamp, entity type and id, action,
      before and after revision, optional attribution.
- [ ] Define `ChangesPage` (items plus cursor) and `ChangeDiff` (path, before
      content, after content, revisions).
- [ ] Define SSE message types as a discriminated union, for example
      `change`, `index-status`, `diagnostics`.
- [ ] Move `ChangeKind`, `SymbolKind`, and `ActivityEvent` out of
      `apps/web/src/features/dashboard/types.ts` once the shared versions exist.

### Post-MVP

- [ ] Define `Attribution` (`confirmed`, `inferred`, `unknown`) and
      `AgentSession` types.

## Done when

- Every API route in the architecture document has request and response types
  here, and both server and web import them instead of declaring their own.
- The package builds with no runtime dependencies.

## Notes

- Prefer string literal unions over enums so types erase cleanly.
- Keep ids as opaque strings in the contract, even if the database uses
  integers internally.
