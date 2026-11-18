# Agent context and attribution tasks

## V0 semantic proposals

V0 uses optional coding-agent context to improve feature labels and groupings.
The [semantic design](../ARCHITECTURE.md#agent-proposed-context-v0-target)
defines how Mycel checks source references and relationship claims. The
architecture remains usable without a provider-specific adapter.

- [ ] Define how to submit a semantic proposal with its origin, suggested
      classification or grouping, and source references.
- [ ] Resolve references within the current project and validate asserted
      relationships against indexed evidence.
- [ ] Preserve proposal provenance and revalidate affected mappings after source
      changes. Keep unsupported claims separate from verified relationships.

## Post-V0 session attribution

Optional adapters could collect agent session and tool metadata to show which
agent made an observed change. No agent adapter package currently exists.

### Tasks

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

### Tests

- [ ] Concurrent agents editing different files are attributed correctly.
- [ ] Overlapping edits to one file produce `inferred` or `unknown`, not a
      wrong `confirmed`.
- [ ] Mycel behaves the same with no adapters configured.

### Done when

- Activity items show which agent made a change when evidence exists, and
  users can filter by agent.
