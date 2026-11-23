# Dashboard workflow validation

Run from the workspace after installing dependencies:

```sh
pnpm exec playwright install chromium
pnpm test:workflow
```

The workflow builds the workspace and runs three checks in Chromium. Each
check creates a disposable Git repository and launches `startIndexedServer`
with a dedicated SQLite database. The dashboard runner saves screenshots and
`result.json` in the temporary directory printed in its output.

The architecture and relationship runners verify the Graph landing view,
fallback and named component maps, connection evidence and source drill-down,
and live updates to recorded imports and calls. The file and symbol runner
verifies:

1. Backend and SSE status, the visible graph legend, selection highlighting,
   connection-only filtering and clearing selection, file dependencies and
   symbol drill-down, explorer search, graph selection, expansion/collapse,
   caller navigation, and source navigation to the caller's declaration line.
2. Creating a new caller updates the graph and highlights the new node.
3. Modifying a function refreshes its open source and highlights the node.
4. Node activity opens recorded source and the before/after Monaco diff.
5. Selected changes survive reloads and browser Back navigation.
6. Deleted nodes disappear from the live graph, remain available in history, and
   expose their saved source before deletion.
7. An interrupted server connection shows disconnected status, reconnects after
   restart, and receives further edits without duplicate events. The test cuts
   active sockets to simulate interruption; graceful shutdown has separate server
   tests.
8. The mobile explorer fits the viewport. The browser reports no runtime errors,
   and all requested assets and Monaco workers stay on the local server origin.

The runner asserts exact recorded source revisions in addition to checking the
rendered Monaco editors. Navigating between diffs and away from history catches
editor/model disposal errors that mocked component tests cannot detect.

## External coding agent mode

Set `MYCEL_WORKFLOW_DIR` to a fresh directory. The browser runner initializes
`repository/` and `control/` below it, then waits for an external agent to make
each edit. Without this environment variable the runner makes the same filesystem
edits itself for repeatable local testing.

```sh
MYCEL_WORKFLOW_DIR=/tmp/mycel-agent-workflow node scripts/test-dashboard.mjs
```

The external agent must wait for each `control/<phase>.ready` file, perform the
corresponding edit in `repository/`, then write `control/<phase>.done`. Each phase
has a two-minute timeout. Source must contain actual newline characters.

| Phase | Required edit |
| --- | --- |
| `create` | Create `generated.ts` importing `double` from `./math` and exporting `generated()` which returns `double(4)`. |
| `modify` | Change `math.ts` so `double(value: number)` returns `value * 3`. |
| `delete` | Delete `obsolete.ts`. |
| `reconnect` | After the server restarts, change `double` to return `value * 4`. |

Do not modify Mycel's own checkout, commit changes, or create later edits before
their ready markers. The browser drives the phase transitions only after the
previous change has been verified in the UI.

## Observed external-agent run

On 2026-11-13, a separate Codex agent performed all four edits while the Chromium
workflow exercised the live dashboard. The runner reported `passed`, with
`externalAgent: true`, zero browser runtime errors, and zero off-origin requests.
The fixture and evidence were saved at `/tmp/mycel-external-dashboard-ISyMGF/`.
These temporary files are local evidence and are not required to rerun the test.
