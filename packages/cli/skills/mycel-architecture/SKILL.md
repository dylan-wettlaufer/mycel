---
name: mycel-architecture
description: Create or refresh a repository’s Mycel architecture map by naming its subsystems, assigning source paths, and checking coverage with the Mycel CLI.
---

Read the repository overview, manifests, entry points and existing .mycel/architecture.json. Follow a representative user action through the code. Inspect implementations on both sides of each proposed boundary to establish what each part owns.

Choose roughly 5–15 parts that a maintainer would use to explain the system. Group files across directories when they serve one responsibility. Split a large package when it contains distinct capabilities. Keep existing IDs for responsibilities that survive a refresh. Give each part a recognizable name and one short, active sentence describing what it does for a user or another subsystem.

Save .mycel/architecture.json at the repository root, creating the directory if needed. Use this shape, replacing the example part with the actual parts:

```json
{
  "version": 1,
  "source": "agent",
  "parts": [
    {
      "id": "source-index",
      "name": "Source indexing",
      "purpose": "Tracks source changes and resolves references between files.",
      "kind": "library",
      "paths": ["src/indexing/**"]
    }
  ]
}
```

Use unique lowercase slug IDs up to 64 characters. Names fit on one line within 80 characters and purposes within 200. Choose app, service, library, data, integration, or cli for kind. Mycel derives edges from indexed imports and calls.

Use repository-relative paths with forward slashes. Literal directories include descendants. For overlapping globs, the most literal leading segments win, followed by the longest pattern, then declaration order.

Run `mycel architecture` in the target repository (in the Mycel development checkout, use `pnpm build` and `pnpm start architecture`). It exits with status 1 when the file is invalid or a pattern matches no indexed source file. Fix schema errors, fix or remove unmatched patterns (usually typos, or files in languages Mycel does not index), and narrow tied patterns to express ownership. Review every unassigned file and give it an owner when justified. Rerun after edits and report any intentional folder fallbacks.
