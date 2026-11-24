# mycel

> Mycel helps developers understand what their AI agents are building and how it fits into the rest of their application.

Mycel is a local-first architecture map for your repository. Run it in a
project and it opens a live dashboard showing the parts of your application
and how they connect. Click a connection to see the exact imports and calls
behind it. As you or a coding agent save changes, the map updates and
**Activity** shows what changed, which relationships were added or removed,
and which agent made the edit.

**Status:** V0, pre-release. Mycel installs from source; there is no npm
package yet. It indexes TypeScript, TSX, and Python.

- [Features](#features)
- [Quickstart](#quickstart)
- [First walkthrough](#first-walkthrough)
- [Name your subsystems](#name-your-subsystems)
- [See which agent made a change](#see-which-agent-made-a-change)
- [Commands](#commands)
- [Privacy and local data](#privacy-and-local-data)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)

## Features

- **Graph: how do the parts of my app connect?** An architecture map of
  packages or named subsystems. Select a connection to inspect the imports and
  calls behind it, then drill down to files, symbols, and source.
- **Activity: what just changed?** Every save, including uncommitted edits,
  with a source diff, the symbols that changed, and the relationships that
  were added or removed.
- **Agent attribution: who changed it?** Edits from Codex, Claude Code, and
  Cursor are labeled with the agent and session that made them.
- **Explorer: where is it?** Search indexed files and symbols.
- **Live updates.** The map refreshes as files are saved and highlights recent
  relationship changes.

TypeScript and TSX show imports, calls, and symbols. Python shows file-to-file
connections from module-level imports.

## Quickstart

### Requirements

- Node.js 22.x (22.22.2+), 24.x (24.15.0+), or 26.x
- pnpm 10.34.7 (or run `npx pnpm@10.34.7` in place of `pnpm`)
- Git

### Install from source

```sh
git clone https://github.com/dylan-wettlaufer/mycel.git
cd mycel
pnpm install
pnpm build
npx pnpm@10.34.7 link --global ./packages/cli
```

Linking keeps the `mycel` command connected to this checkout, so rebuild after
pulling changes. If pnpm reports that its global bin directory is missing from
`PATH`, run `pnpm setup`, restart your shell, and retry the link command.

### Run it

```sh
cd /path/to/your/project
mycel
```

Mycel finds the Git root, indexes the repository, and opens the dashboard in
your browser at the URL it prints. The terminal reports initial indexing
progress. The dashboard shows the last committed index revision and lists
unreadable files with steps to check. Mycel keeps watching for saves until you
press Ctrl+C. Outside a Git repository it uses the current folder.

On launch, Mycel also registers attribution hooks in the user settings of any
coding agents it detects (Codex, Claude Code, Cursor) and enables capture for
this repository when setup succeeds. Run `mycel --no-agent-hooks` to skip
registration and disable Mycel-managed capture for this repository. Use
`mycel hooks uninstall` to remove managed registrations from user settings.
A later normal launch can enable capture again. See [agent setup](#see-which-agent-made-a-change).

## First walkthrough

1. **Read the map.** The dashboard opens on **Graph**. Until you
   [name your subsystems](#name-your-subsystems), the map shows one part per
   workspace package or top-level folder.
2. **Follow a connection.** Select a part to see its files and connections.
   Select a connection to list the imports and calls behind it, then select a
   line to read that source, or choose **Open source** for the whole file.
3. **Drill down.** Use **Open files** to see file dependencies and symbols, or
   **Open component** when a part has named responsibilities. **Only
   connections** narrows the graph; **Focus selection** frames a node and its
   neighbors.
4. **Make a change.** Add an import or function call between two files and
   save. The map highlights the new relationship.
5. **Review it.** Open **Activity**. **Files** shows the save with its diff and
   changed symbols; **Relationships** shows the added call or import with a
   link to its source.

Graph and change selections are kept in the URL, so browser back and forward
reopen them.

## Name your subsystems

The default map groups code by package or folder. To see real subsystems such
as Orders, Payments, or persistence, have a coding agent write
`.mycel/architecture.json` for you:

```sh
mycel install-skill   # adds the skill to .agents/skills and .claude/skills
```

Then ask Codex or Claude Code to use the `mycel-architecture` skill. Check the
result with:

```sh
mycel architecture
```

This lists unassigned files, tie warnings, and patterns that match no indexed
file. To break one part down further, ask your agent something like "Add a
Mycel drill-down for Repository indexing", then inspect it with
`mycel architecture --component <name-or-id>`. See the
[architecture file format](docs/ARCHITECTURE_MAP.md#architecture-file-format).

If the file is invalid, the dashboard keeps the default map and shows a
validation message.

## See which agent made a change

**Activity → Files** shows the hook status for each detected agent and the
last event it sent. After a supported edit, the file row and diff show the
provider, session, and a confidence level: **confirmed** when Mycel matched the
exact content, otherwise **inferred**.

| Agent | What it reports | Setup |
| --- | --- | --- |
| Codex | Successful `apply_patch` edits | Approve the Mycel hook once in **Settings → Hooks** or `/hooks` ([reference](https://learn.chatgpt.com/docs/hooks)) |
| Claude Code | `Edit` and `Write` tool calls | Automatic ([reference](https://code.claude.com/docs/en/hooks)) |
| Cursor | Completed Agent file edits | Automatic ([reference](https://cursor.com/docs/hooks)) |

Shell writes, Cursor Tab completions, and ordinary saves appear as unattributed
file changes. When evidence for one save conflicts, it shows **Agent unknown**.
Hooks you configured manually are controlled in the agent's own settings.
`mycel hooks status` lists managed registrations in user settings and capture
status for the current repository. `mycel hooks uninstall` removes those
user-level registrations and disables capture for the current repository.
A later normal launch can register hooks again.

## Commands

| Command | What it does |
| --- | --- |
| `mycel` | Index the current repository and open the dashboard |
| `mycel --no-open` | Start without opening a browser; open the printed URL yourself |
| `mycel --no-agent-hooks` | Skip hook registration and disable managed capture for this repository |
| `mycel install-skill` | Add the `mycel-architecture` skill for Codex and Claude Code |
| `mycel architecture` | Validate `.mycel/architecture.json`; exits 1 if it is missing or invalid, or a pattern matches nothing |
| `mycel architecture --component <name-or-id>` | Show a part's files, connections, and responsibility assignments |
| `mycel history status` | Show recorded history and source storage for this repository |
| `mycel history clear` | Remove past history, reclaim SQLite space, and keep the current index |
| `mycel project remove` | Remove this repository's local index and history after closing its dashboards |
| `mycel hooks status` | Show managed hooks and whether capture is enabled for this repository |
| `mycel hooks uninstall` | Remove managed user-level registrations and disable capture for this repository |
| `mycel --help`, `mycel --version` | Show usage or version |

## Privacy and local data

Mycel runs entirely on your machine. The dashboard server listens only on
`127.0.0.1`, on an available port chosen at each launch. The index, change
history, and attribution metadata are stored in a SQLite database outside your
repository:

- macOS: `~/Library/Application Support/Mycel`
- Linux: `$XDG_DATA_HOME/mycel`, or `~/.local/share/mycel`
- Windows: `%LOCALAPPDATA%\Mycel`

The only files Mycel writes to your repository are the ones you ask for:
`.mycel/architecture.json` (written by your agent) and the skill files from
`mycel install-skill`. Attribution hooks go in each agent's user settings.

## Troubleshooting

- **`mycel: command not found`.** Run `pnpm setup`, restart your shell, and
  repeat the link step in [Install from source](#install-from-source).
- **The browser didn't open.** Copy the URL printed in the terminal, or start
  with `mycel --no-open`.
- **The map is empty.** Save a TypeScript, TSX, or Python file in a path that
  isn't ignored by `.gitignore`.
- **The map failed to load.** Use **Retry**. A failed refresh keeps the last
  loaded map visible.
- **Codex edits show no agent.** Approve the Mycel hook in Codex under
  **Settings → Hooks** or `/hooks`.

## Documentation

- [Product vision and V0 requirements](mycel_prd.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Architecture map and `architecture.json`](docs/ARCHITECTURE_MAP.md)
- [Local HTTP API](packages/server/README.md)
- [Semantic graph](docs/SEMANTIC_GRAPH.md),
  [feature discovery](docs/FEATURE_DISCOVERY.md), and
  [behaviour tracing](docs/BEHAVIOUR_TRACING.md) (experimental, API only)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, tests, and the
workspace layout. Remaining work is tracked in the
[package task lists](docs/tasks/).

## License

Mycel does not have a license yet. Choosing one is tracked in the
[release tasks](docs/tasks/tooling-and-release.md).
