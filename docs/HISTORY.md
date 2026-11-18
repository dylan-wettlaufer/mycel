# Change history and live events

History lets developers review a source change while exploring the current
architecture. The current feed records structural node and edge changes. The
[V0 update flow](ARCHITECTURE.md#change-pipeline) also needs to refresh features
and their evidence when a commit changes only semantic mappings.

The live indexer compares stable node and edge identities with the persisted
project graph. Changes to content, ranges, or relationships produce created,
modified, and deleted events; revision metadata alone does not produce events.
On startup it compares the working tree with persisted state, capturing offline
edits without duplicating unchanged events. Renames remain delete plus create.

Each change set writes the graph, a new project revision, full source snapshots,
and event records in one transaction. Subscribers run only after commit. Failed
writes leave no history or graph changes; subscriber failures cannot undo commits
or cause duplicate events. Source retained after parser failures corresponds to
the last valid graph. Monitoring sessions record launch time, starting revision,
and normal shutdown time; events identify their session.

## Read-only HTTP API

- `GET /api/changes?cursor=<id>&limit=50`: newest events first. The optional
  cursor is exclusive; follow the returned `cursor` until it is null. Limits
  are 1–100. Concurrent inserts do not shift subsequent pages.
- `GET /api/changes/:id/diff`: full before/after source for the event's path.
  Missing source is null; empty source is an empty string. Revisions describe
  the returned source sides, so a symbol deletion can retain both file sides.
  Events preserve entity before/after data even after the live entity is deleted.
- `GET /api/events`: SSE frames named `change`, JSON `ChangeEvent` payloads,
  with decimal event IDs. Supply `Last-Event-ID` to resume exclusively after
  that event; omission replays available history from the beginning. Replay is
  ascending, bounded in batches, followed by live commits without a handoff gap.
  Idle streams receive comment heartbeats every 15 seconds. Disconnects and
  engine/server shutdown release subscriptions and timers.

All reads are scoped by core to the selected project. IDs are opaque decimal
strings representing safe integers, increase across database reopen, and may
have gaps. API validation rejects malformed cursors and limits. Missing history
returns 503; unknown or pruned diffs return 404.

## Storage and retention

History is kept indefinitely by default. Each committed revision currently
captures all accepted source files, favoring simple reliable diffs over storage
compression. `@mycel/db` exposes the explicit administrative operation
`pruneHistory(database, projectId, beforeId)`: delete events strictly before an
ID and remove snapshots no longer needed by retained events or the current
revision. There is no automatic pruning or mutating HTTP route. Replay after a
pruned cursor returns only retained events; it cannot restore deleted history.

`commitChangeSet` accepts a complete graph and source capture plus changes
computed by core. The caller is responsible for supplying matching graph facts
and source; persistence owns transaction boundaries and constraints. Existing
version-1 databases migrate automatically, and the next live startup establishes
source snapshots for subsequent history.

Verification includes rollback injection, project isolation, pagination, empty
and deleted source diffs, retention, offline reconciliation, restart ID ordering,
rapid writes, commit-only notifications, SSE replay, disconnect, and shutdown.
