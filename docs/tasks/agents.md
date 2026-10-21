# `@mycel/agents` tasks (post-MVP)

Optional adapters that capture coding-agent session and tool metadata and
attribute observed changes to agents. Attribution is supplementary: the graph
is always derived from source, and the core workflow must work without any
adapter.

Start only after the MVP (phases 1 to 5) is complete.

## Current state

- Package does not exist yet.

## Tasks

- [ ] Create `packages/agents` and add the `agents` commit scope to
      `AGENTS.md`.
- [ ] Define an adapter interface independent of the indexer: start and stop,
      and a stream of agent events (session id, tool name, timestamp, affected
      paths).
- [ ] Implement a Claude Code adapter using its supported session and tool
      hooks.
- [ ] Store agent sessions and tool events in db, in new tables added by
      migration.
- [ ] Correlate agent events with observed file changes by path and time
      window.
- [ ] Record attribution as `confirmed`, `inferred`, or `unknown`, and never
      force an ambiguous assignment.
- [ ] Expose attribution on change events through the API and SSE.
- [ ] Flag overlapping changes to the same file or symbol by different agents.
- [ ] Investigate Codex and Cursor integration mechanisms before building
      adapters for them.

## Tests

- [ ] Concurrent agents editing different files are attributed correctly.
- [ ] Overlapping edits to one file produce `inferred` or `unknown`, not a
      wrong `confirmed`.
- [ ] Mycel behaves the same with no adapters configured.

## Done when

- Activity items show which agent made a change when evidence exists, and
  users can filter by agent.
