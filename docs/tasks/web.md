# `@mycel/web` tasks

The browser dashboard: overview, explorer, graph, activity feed, and source and
diff viewers. It talks only to `/api` using types from `@mycel/shared`.

See [architecture](../ARCHITECTURE.md#frontend).

## Current state

- Vite 8, React 19, TypeScript, Tailwind CSS v4, and shadcn/ui (`new-york`
  style) with the Mycel theme in `src/index.css`, dark by default, with Geist
  and JetBrains Mono bundled locally.
- `AppShell` with a sidebar (Dashboard enabled; Graph, Activity, and Explorer
  disabled), a project header, and a connection badge.
- `useBackendHealth` polls `/api/health` every five seconds with a
  three-second timeout. `useProject` loads `/api/project` once connected.
- The dashboard shows the repository root, plus sample stats and activity from
  `features/dashboard/mock-data.ts`.
- Vitest tests for health polling and app rendering.

## Tasks

### Cleanup

- [ ] Use one `cn` helper. The generated components in `components/ui` import
      it from the `cn` package, while app code uses `@/lib/utils`. Point
      `components.json` and the components at one of them and remove the
      other dependency.
- [ ] Move `import type { ProjectInfo }` in `dashboard-page.tsx` from the bottom
      of the file to the top.
- [ ] Add client-side routing (for example React Router or TanStack Router)
      for dashboard, explorer, graph, activity, and change detail views. The
      server already serves `index.html` for client routes.
- [ ] Choose a data-fetching approach (for example TanStack Query) before
      adding more endpoints, replacing the hand-rolled hooks where it makes
      things simpler.

### Phase 2 to 4: real data on the dashboard

- [ ] Replace sample stats with real counts from the server.
- [ ] Replace sample activity with `/api/changes`.
- [ ] Show indexing progress and the database status from `/api/health`.
- [ ] Show a diagnostics count with a way to list parser and resolution errors.
- [ ] Delete `mock-data.ts` and the local types once shared types exist.

### Phase 5: explorer

- [ ] Searchable list or tree of files and symbols backed by
      `/api/graph/search`, using shadcn/ui components (for example `command`
      for search).
- [ ] Selecting an item opens node details.

### Phase 5: graph

- [ ] Add React Flow (`@xyflow/react`) and render the neighborhood from
      `/api/graph/nodes/:id/neighborhood`.
- [ ] Automatic layout for small subgraphs (for example dagre or ELK).
- [ ] Expand and collapse controls that fetch more of the neighborhood within
      a bound, with a visible note when results are truncated.
- [ ] Style node kinds and edge kinds distinctly using theme tokens.

### Phase 5: node details

- [ ] Panel showing kind, qualified name, path and range, callers,
      dependencies, and related files, with links to each.

### Phase 5: source and diff

- [ ] Monaco read-only source viewer that loads `/api/files/content` and
      scrolls to the selected symbol's range.
- [ ] Monaco diff viewer for `/api/changes/:id/diff`.
- [ ] Load Monaco lazily so the initial bundle stays small, and bundle its
      workers locally with no CDN.
- [ ] Match the Monaco theme to the Mycel theme.

### Phase 5: live activity

- [ ] Subscribe to `/api/events` with `EventSource`, which reconnects and
      sends `Last-Event-ID` automatically.
- [ ] Prepend new events to the activity feed and update stats and the graph.
- [ ] Highlight recently created and modified nodes, and show deleted nodes in
      history views.
- [ ] Navigate between an activity event, its graph node, its source, and its
      diff.
- [ ] Reflect SSE connection state in the header badge alongside health.

### Post-MVP

- [ ] Show agent identity on activity items and add agent filters.

## Tests

- [ ] API client parsing and error handling for each endpoint.
- [ ] Activity feed applies SSE events in order and survives reconnects.
- [ ] Explorer search, graph selection, and source navigation with mocked
      responses.

## Done when

- A user can search for a symbol, explore its neighborhood, open its source,
  and watch changes arrive live with correct diffs, all without sample data.
