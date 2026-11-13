import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { watchSourceFiles } from "../dist/index.js";

async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail("Timed out waiting for file event");
    await setTimeout(20);
  }
}

test("watches source additions, edits, deletions, and renames; closes cleanly", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mycel-watch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "main.ts"), "original");
  const changes = [];
  const errors = [];
  const watcher = watchSourceFiles({
    root,
    onChange: (c) => changes.push(c),
    onError: (e) => errors.push(e),
  });
  t.after(() => watcher.close());
  await watcher.ready;
  assert.equal(changes.length, 0);
  await writeFile(join(root, "new.tsx"), "added");
  await until(() =>
    changes.some((c) => c.kind === "add" && c.path === "new.tsx"),
  );
  await writeFile(join(root, "main.ts"), "edited");
  await until(() =>
    changes.some((c) => c.kind === "change" && c.path === "main.ts"),
  );
  await rename(join(root, "new.tsx"), join(root, "renamed.tsx"));
  await until(
    () =>
      changes.some((c) => c.kind === "unlink" && c.path === "new.tsx") &&
      changes.some((c) => c.kind === "add" && c.path === "renamed.tsx"),
  );
  await rm(join(root, "main.ts"));
  await until(() =>
    changes.some((c) => c.kind === "unlink" && c.path === "main.ts"),
  );
  await mkdir(join(root, "node_modules"));
  await writeFile(join(root, "node_modules", "hidden.ts"), "ignored");
  await writeFile(join(root, "readme.md"), "ignored");
  await writeFile(join(root, ".gitignore"), "hidden.ts");
  await until(() => changes.some((c) => c.path === ".gitignore"));
  assert.ok(changes.every((c) => c.observedAt > 0));
  assert.ok(
    !changes.some((c) => c.path.includes("hidden") || c.path.endsWith(".md")),
  );
  await watcher.close();
  const count = changes.length;
  await writeFile(join(root, "after.ts"), "closed");
  await setTimeout(150);
  assert.equal(changes.length, count);
  assert.deepEqual(errors, []);
});
