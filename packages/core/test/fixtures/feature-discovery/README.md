# Unannotated feature discovery fixture

The fixture sources contain no Mycel tags. Tests materialize `.txt` files as an
ordinary Next/React application in a temporary repository; no framework runtime
or dependency installation is required.

- `(workspace)/orders` and its `[id]` page form one route area.
- `(workspace)/billing` forms a second area.
- `(marketing)/page.tsx` supplies a group-root candidate.
- `features/reports/ReportsPanel` supplies a directory-only candidate.
- `features/shared` and a directory containing only configuration do not create
  candidates.
- Root/workspace layouts, a button, and a called transport service exercise shared
  membership without exclusive ownership. Unused service functions remain unknown.

Annotated test variants are applied to these sources at runtime. Watcher tests
exercise source/reference edits, directory and group renames, explicit override
promotion/demotion, service movement, and deletion. See
[feature discovery](../../../../../docs/FEATURE_DISCOVERY.md).
