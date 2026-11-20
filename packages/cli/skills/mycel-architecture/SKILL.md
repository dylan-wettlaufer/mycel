---
name: mycel-architecture
description: Create or refresh a Mycel architecture map, or add an on-demand drill-down for a named component. Validate file assignments and inspect indexed dependencies with the Mycel CLI.
---

## Component drill-down

Use this workflow when asked to expand a specific top-level component. Resolve its name to an ID in `.mycel/architecture.json`, asking for a choice if the request matches multiple parts. Run `mycel architecture --component <id>` for its owned files, callers, dependencies, and internal links. In the Mycel development checkout, build with `pnpm build` and use `pnpm start architecture --component <id>`.

Trace a representative operation from its entry point. Read the implementation before naming groups. Use a handful of responsibilities that explain the component, and leave a small component with one clear job at the file level. Use paths from its owned files and allow incidental files to land in **Other files**.

Add or update only the chosen part's `subcomponents` array. Each entry has `id`, `name`, `purpose`, and repository-relative `paths`. Keep stable IDs on refresh. Put the responsibility that best explains the component first, since the map opens focused on it. Preserve the rest of the architecture definition. Mycel derives every connection from its index.

For a proposal request, present the groups, representative files, and opening focus. For a request to add the drill-down, save the breakdown and rerun the component report. Check that each responsibility owns the intended files, resolve accidental overlaps or unmatched patterns, and mention any intentional **Other files**.

## Top-level map

Read the repository overview, manifests, entry points and existing .mycel/architecture.json. Follow a representative user action through the code. Inspect implementations on both sides of each proposed boundary to establish what each part owns.

Choose roughly 5–15 parts that a maintainer would use to explain the system. Group files across directories when they serve one responsibility. Split a large package when it contains distinct capabilities. Keep existing IDs and preserve existing drill-downs for responsibilities that survive a refresh. Give each part a recognizable name and one short, active sentence describing what it does for a user or another subsystem. Add new drill-downs when requested for a component.

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
