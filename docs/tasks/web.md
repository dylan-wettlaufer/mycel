# `@mycel/web` tasks

The browser workspace presents architecture, file dependencies, source, and changes
at different levels of detail. It talks to `/api` using types from
`@mycel/shared`.

See [architecture](../ARCHITECTURE.md#frontend).

## Current state

- Vite 8, React 19, TypeScript, Tailwind CSS v4, and shadcn/ui (`new-york`
  style) with the Mycel theme in `src/index.css`, dark by default, with Geist
  and JetBrains Mono bundled locally.
- Responsive `AppShell` with Graph, Explorer, and Activity, project metadata, backend
  health, and separate SSE status.
- Real counts, debounced explorer search, bounded React Flow neighborhoods with
  dagre layout, and details with linked relationships and diagnostics.
- Architecture map as the landing view, with named component responsibilities,
  file dependency and source drill-downs, and recent relationship changes.
- Lazily loaded Monaco source and diff viewers, with local workers and captured
  revision content. Deleted nodes retain saved metadata and source in history.
- `useResource` provides validated, abortable reads; `useActivity` merges history
  pages and batched SSE events. Hash navigation preserves selections and supports
  browser Back/Forward and reloads.
- Vitest coverage and a real Chromium workflow, including external agent edits;
  see [workflow testing](../testing/dashboard-workflow.md).

## Tasks

### V0 architecture workflow

- [x] Land on an architecture map of parts and subsystems with
      source-backed relationships.
- [x] Open a component or part, follow a resolved import or call into indexed
      source, and return to the evidence and map.
- [x] Refresh affected architecture scopes from the committed revision and keep
      the current selection when it remains valid.
- [x] Explain empty indexes, isolated parts, and stale component links. Retry
      failed loads and keep the last successful map after a failed refresh.
- [x] Show when the connection evidence and source location lists are capped.

See [V0 acceptance criteria](../../mycel_prd.md#minimum-v0-scope).

### Cleanup

- [ ] Use one `cn` helper. The generated components in `components/ui` import
      it from the `cn` package, while app code uses `@/lib/utils`. Point
      `components.json` and the components at one of them and remove the
      other dependency.
- [x] Move `import type { ProjectInfo }` in `dashboard-page.tsx` from the bottom
      of the file to the top.
- [x] Add client-side routing (implemented with hash navigation)
      for dashboard, explorer, graph, activity, and change detail views. The
      server already serves `index.html` for client routes.
- [x] Choose a data-fetching approach (`useResource` and `useActivity`) before
      adding more endpoints, replacing the hand-rolled hooks where it makes
      things simpler.

### Phase 2 to 4: real data on the dashboard

- [x] Replace sample stats with real counts from the server.
- [x] Replace sample activity with `/api/changes`.
- [ ] Show indexing progress and the database status from `/api/health`.
- [ ] Show a diagnostics count with a way to list parser and resolution errors.
- [x] Delete `mock-data.ts` and the local types once shared types exist.

### Phase 5: explorer

- [x] Searchable list or tree of files and symbols backed by
      `/api/graph/search`, using shadcn/ui components (for example `command`
      for search).
- [x] Selecting an item opens node details.

### Phase 5: graph

- [x] Add React Flow (`@xyflow/react`) and render the neighborhood from
      `/api/graph/nodes/:id/neighborhood`.
- [x] Automatic layout for small subgraphs (for example dagre or ELK).
- [x] Expand and collapse controls that fetch more of the neighborhood within
      a bound, with a visible note when results are truncated.
- [x] Style node kinds and edge kinds distinctly using theme tokens.

### Phase 5: node details

- [x] Panel showing kind, qualified name, path and range, callers,
      dependencies, and related files, with links to each.

### Phase 5: source and diff

- [x] Monaco read-only source viewer that loads `/api/files/content` and
      scrolls to the selected symbol's range.
- [x] Monaco diff viewer for `/api/changes/:id/diff`.
- [x] Load Monaco lazily so the initial bundle stays small, and bundle its
      workers locally with no CDN.
- [x] Match the Monaco theme to the Mycel theme.

### Phase 5: live activity

- [x] Subscribe to `/api/events` with `EventSource`, which reconnects and
      sends `Last-Event-ID` automatically.
- [x] Prepend new events to the activity feed and update stats and the graph.
- [x] Highlight recently created and modified nodes, and show deleted nodes in
      history views.
- [x] Navigate between an activity event, its graph node, its source, and its
      diff.
- [x] Reflect SSE connection state in the header badge alongside health.

### Post-V0

- [ ] Show agent identity on activity items and add agent filters.

## Tests

- [ ] API client parsing and error handling for each endpoint.
- [x] Activity feed applies SSE events in order and survives reconnects.
- [x] Explorer and source navigation with mocked responses, plus real Chromium
      graph, activity, and source navigation tests.

## Done when

- A user can open the architecture map, follow a connection to its source,
  return to the map, and see architecture changes as edits commit.
