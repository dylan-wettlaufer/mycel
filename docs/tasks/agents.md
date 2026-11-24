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

On a normal `mycel` launch, the CLI registers hooks in the user settings of
detected Claude Code, Codex, and Cursor installations as needed, then enables
managed capture for the current repository when setup succeeds. Run
`mycel --no-agent-hooks` to skip registration and disable managed capture for
that repository. Use `mycel hooks status` to inspect managed registrations
and `mycel hooks uninstall` to remove them from user settings. A later normal
launch can register hooks again.

The watcher records file changes. Hooks supply session evidence for those
changes in Activity. See [agent setup and attribution](../../README.md#see-which-agent-made-a-change).

### Tasks

- [x] Create `packages/agents` and add the `agents` commit scope to
      `AGENTS.md`.
- [x] Define an adapter interface independent of the indexer that normalizes
      hook input to tool events with a session ID, path, and timestamp.
- [x] Implement Claude Code capture using supported edit and write tool hooks.
- [x] Implement Codex attribution from successful native `apply_patch` calls.
- [x] Implement Cursor attribution from completed Agent file edits.
- [x] Store tool events with provider session IDs and optional content hashes
      in a dedicated database table.
- [x] Correlate tool events with observed file changes by path and capture
      time, including completion hooks that arrive after the indexed save.
- [x] Record attribution as `confirmed`, `inferred`, or `unknown` and
      display it on file changes in Activity.
- [x] Expose attribution through history queries and signal updates over SSE.
- [x] Set up hooks for detected agents on normal CLI launch and provide a
      per-repository opt-out for managed capture.
- [x] Inspect and uninstall managed registrations through the CLI.
- [ ] Add agent session filters once users have sessions to review.
- [ ] Record explicit agent session lifecycle events if session review needs
      them.
- [ ] Flag overlapping changes to the same file or symbol by different agents.

### Tests

- [x] Concurrent sessions editing different files are attributed independently.
- [x] Overlapping edits to one file produce `unknown`.
- [x] Ordinary saves continue to appear without an agent identity.

### Done when

- Activity identifies agent sessions when evidence supports an assignment and
  keeps ambiguous file changes visible.
