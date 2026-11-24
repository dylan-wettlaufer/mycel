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

Mycel keeps history until you clear it. Each revision records which source
content belongs to each path. Identical source text is stored once per project,
including across renames and reversions. Upgrading an older index converts its
existing snapshots transactionally and preserves exact revision lookups.
The first migration may need temporary disk space while both representations exist.

From anywhere in the repository, run `mycel history status` to display the
database path, SQLite page allocation, recorded event count, and byte count for
unique source content. Page allocation covers the database and its indexes.
The source byte count includes the current index.

Run `mycel history clear` to remove recorded events, prior source snapshots,
agent evidence, and completed monitoring sessions for this project. Mycel keeps
the current graph and source as a baseline for the next diff. The command
compacts the database and truncates its write-ahead log to reclaim space. If a
concurrent connection blocks compaction, close other Mycel sessions for the
repository and run the command again. A running watcher can record subsequent
edits. Reload open dashboards to discard activity already loaded in memory.

To remove all indexed project data, close the dashboards for that
repository and run `mycel project remove`. It deletes the current graph,
source archive, activity, and managed capture marker, then compacts the
SQLite file. The remaining database contains the schema so Mycel can
create a fresh index on the next launch. If SQLite reports corruption,
the command removes the managed database and its SQLite sidecars so the
next launch can rebuild it. Your working files stay in the repository.

For partial retention, `pruneHistory(database, projectId, beforeId)` deletes
events before an exclusive ID. It preserves current source and both source
sides of retained events. Cursor replay resumes with retained events.

`commitChangeSet` accepts a complete graph and source capture plus changes
computed by core. The caller is responsible for supplying matching graph facts
and source; persistence owns transaction boundaries and constraints. Existing
version-1 databases migrate automatically, and the next live startup establishes
source snapshots for subsequent history.

Verification includes rollback injection, project isolation, pagination, empty
and deleted source diffs, retention, offline reconciliation, restart ID ordering,
rapid writes, commit-only notifications, SSE replay, disconnect, and shutdown.
