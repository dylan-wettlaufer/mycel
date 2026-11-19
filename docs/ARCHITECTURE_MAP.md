# Architecture map plan

This document records the November 2026 product review of Mycel, the direction
we agreed on, and the work remaining for a solid V0 architecture map. It
complements the [PRD](../mycel_prd.md), which already describes the map as
[V0-03](../mycel_prd.md#v0-03--high-level-architecture-visualization).

## Why: what was missing

Mycel's promise is to show the parts of an application and how they connect,
so people can understand what they and their agents are building. The review
found that the evidence layer is solid, but the product the PRD describes is
not built yet.

What works today:

- Tree-sitter indexing with import and call resolution, SQLite revisions, and
  live updates through the watcher and server-sent events.
- Explorer, Monaco source view, and Activity with diffs and retained source.
- A per-feature behaviour graph laid out as an architectural diagram
  (interface, API, logic, service, data layers).
- A structural graph of folders and import counts, which is the landing view.

What is missing:

1. **No architecture map.** Features are a list. Nothing connects one feature
   to another, and there is no concept of a subsystem shared by features. The
   PRD's workflow "select Orders and see where it connects to Payments" cannot
   be answered anywhere.
2. **Discovery only understands one kind of app.** Features come from Next.js
   routes, `features/<name>/` folders, and `services/` folders; behaviour traces
   only follow React → `fetch` → Next App Router → Prisma. Indexing Mycel
   itself produced seven "features" that are frontend folder names, while the
   backend packages (parser, core, db, server) were not represented at all.
3. **Only TypeScript is parsed.** The parser ships the TypeScript grammar only.
4. **No architecture-level change view.** Activity lists file events; nothing
   says "this branch added a part" or "this connection is new".
5. **No agent intake.** Agent-proposed context is described in the PRD but not
   implemented.

## Goals

From the conversation, the map should:

- Show all the parts of an app and how they connect, not individual files.
- Highlight parts and connections that were added or changed recently, so new
  code stands out.
- Work for any repository: Python, Go, TypeScript, Rust, web apps, CLIs, and
  libraries.
- Primarily help people understand their codebase; reviewing what an agent
  just built is one core use of the same view.

## Decisions

### Agents propose parts, Mycel computes connections

An agent skill (for Claude Code, Codex, and similar tools) reads the repository
and writes `.mycel/architecture.json`, naming the parts of the app, describing
each in one line, and listing the paths that belong to it. Agents understand
meaning across languages, which no folder rule can.

Mycel owns everything that must be factual and current:

- **Connections** come only from indexed imports and calls that cross between
  parts. Every arrow lists its evidence; agents never declare edges.
- **Recent changes** come from git.
- **Live updates** come from the existing watcher, so the map stays correct
  between agent runs.

Letting the agent build the whole graph was rejected: it goes stale between
runs, can invent connections, costs tokens on every rebuild, and is not
reproducible.

### The map never waits for an agent

Without an architecture file, Mycel builds a fallback map with one part per
workspace package (pnpm, npm, Cargo, Go workspaces) or, failing that, per
top-level source folder. A banner suggests running the Mycel skill for a better
map. Files the agent did not assign fall back to their folder part, and Mycel
reports them so the skill can be re-run.

### "Recent" defaults to the current branch

- On a branch: everything since it split from `main`, which matches a typical
  agent session or feature branch.
- On `main`: the last 7 days.
- Uncommitted changes always get their own, stronger highlight.
- A control switches between uncommitted, branch, 7 days, and 30 days.

Parts and connections have two highlight states: **new** (did not exist before
the window) and **changed** (existed, but their files were edited).

## Architecture file format

Defined in step 1. Types are in `packages/shared/src/architecture.ts`; the zod
validator `parseArchitectureFile` is in `packages/core/src/architecture.ts`,
because `@mycel/shared` stays dependency-free and types-only. The format is
documented in the [shared README](../packages/shared/README.md#architecture-file).

```json
{
  "version": 1,
  "source": "agent",
  "generatedAt": "2026-11-18T21:30:00-05:00",
  "parts": [
    {
      "id": "indexer",
      "name": "Indexing engine",
      "purpose": "Parses source files and keeps the graph up to date.",
      "kind": "library",
      "paths": ["packages/core/**", "packages/parser/**"]
    }
  ]
}
```

Unknown keys are rejected, so declared connections are invalid by construction.

### Path matching

- **No `exclude` list in V0.** The most specific matching pattern wins, so a
  part for `packages/core/test/**` takes those files from a part for
  `packages/core/**`. Files that should not appear at all belong in the existing
  indexing exclude settings. An optional `exclude` can be added later without a
  version bump if real repositories need it.
- **Overlaps are allowed, not rejected.** Whether two globs overlap depends on
  the files that exist, so overlaps are resolved when files are assigned
  (step 3). Specificity is the number of literal leading path segments, then
  pattern length. A true tie goes to the part listed first, and validation
  reports it as a warning so the agent can fix it.

## V0 steps

| Step                                            | Status |
| ----------------------------------------------- | ------ |
| 1. Architecture file format                     | Done   |
| 2. Folder fallback                              | Done   |
| 3. Assign files to parts                        | Done   |
| 4. Connections between parts                    | Done   |
| 5. Recent changes from git                      | Done   |
| 6. API and live updates                         | Done   |
| 7. Architecture map as the landing view         | Done   |
| 8. Agent skill and `mycel architecture` command | Done   |
| 9. Python imports                               | To do  |
| 10. Polish and documentation                    | To do  |

1. **Architecture file format.** Versioned schema with zod validation and tests
   for valid and invalid files.
2. **Folder fallback.** Generate parts from workspace packages or top-level
   source folders when no file exists. Done when Mycel itself yields cli,
   server, core, parser, db, and web.
3. **Assign files to parts.** Every indexed file belongs to exactly one part
   using the specificity rules above; unmatched files go to their fallback part
   and are reported. Tests cover overlaps, unmatched files, and deleted files.
4. **Connections between parts.** Combine resolved imports and calls crossing
   parts into edges with counts and evidence (file, line, symbol). Done when
   Mycel shows web → server, server → core, core → parser, and core → db, each
   backed by real imports.
5. **Recent changes from git.** Find the branch base (or the last 7 days on
   `main`), list added, modified, and uncommitted files, and mark parts and
   connections as new, changed, or unchanged.
6. **API and live updates.** `GET /api/architecture` with a window parameter,
   returning parts, connections, change status, and source; an SSE event when
   the file, index, or git state changes.
7. **Architecture map as the landing view.** Part cards with name, purpose,
   kind, and file count; evidence-backed arrows; new and changed highlights
   with a window toggle; the fallback banner; drill-down into a part's files,
   its behaviour graph where available, and source. Reuses the behaviour graph's
   layout and edge work, with an end-to-end test.
8. **Agent skill and CLI command.** A skill that tells an agent how to choose
   about 5–15 parts and write the file, plus `mycel architecture` to validate it
   and print unassigned files and tie warnings. The skill ships in
   `packages/cli/skills`; `mycel install-skill` copies it into a repository's
   `.agents/skills` and `.claude/skills`.
9. **Python imports.** Add the Tree-sitter Python grammar with file-level
   imports, so a Python fixture repository gets a correct map.
10. **Polish and documentation.** Empty and error states, evidence caps for
    large repositories, and updates to the README and task lists.

Steps 1–7 deliver a working map with change highlights using the fallback.
Steps 8 and 9 make it meaningful and multi-language.

## Out of scope for V0

- Go and Rust parsing.
- Per-language call tracing beyond imports.
- Agent session attribution.
- Editing parts from the UI.

## Open questions

- Whether behaviour graphs should be discoverable for non-Next.js stacks, or
  remain a drill-down only where supported.
