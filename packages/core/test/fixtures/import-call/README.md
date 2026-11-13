# Import and call fixture

`main.ts` imports `validate` from `utils.ts` and calls it inside `save`.
The `.txt` suffix keeps fixture source separate from workspace TypeScript;
the test copies these files to a temporary repository with real `.ts` paths.

`test/fixture-repositories.test.mjs` checks parser extraction and indexes the
repository through `indexRepository` into an empty in-memory database. No
graph edges are manually inserted.

The desired resolved relationships are:

```text
main.ts --IMPORTS--> utils.ts
save    --CALLS----> validate
```

The acceptance tests assert persisted import/call edges and query dependencies
and callers, alongside extraction and containment. All assertions run normally
without TODO markers or seeded edges.

Run just this fixture from the workspace root:

```sh
pnpm --filter @mycel/core... build
node --test packages/core/test/fixture-repositories.test.mjs
```
