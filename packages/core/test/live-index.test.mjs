import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { openDatabase } from "@mycel/db";
import { parseFile } from "@mycel/parser";
import { watchRepository } from "../dist/index.js";

export async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline)
      assert.fail("Timed out waiting for graph update");
    await setTimeout(20);
  }
}

async function fixture(t, sources, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), "mycel-live-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, source] of Object.entries(sources)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), source);
  }
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  const parsed = [];
  const errors = [];
  if (typeof extra === "function") extra = extra(root);
  const live = await watchRepository({
    project: { root, name: "fixture" },
    database: db,
    debounceMs: 25,
    onError: (e) => errors.push(e),
    parse: (path, source) => {
      parsed.push(path);
      return parseFile(path, source);
    },
    ...extra,
  });
  t.after(() => live.close());
  const nodes = () => db.prepare("SELECT * FROM nodes ORDER BY path, id").all();
  const revision = () =>
    db.prepare("SELECT MAX(revision) AS revision FROM revisions").get()
      .revision;
  return { root, db, live, parsed, errors, nodes, revision };
}

test("reparses only changed files and preserves unrelated node records", async (t) => {
  const { root, db, parsed, errors, nodes, revision } = await fixture(t, {
    "main.ts": "function before() {}",
    "keep.ts": "function keep() {}",
  });
  assert.deepEqual(parsed.sort(), ["keep.ts", "main.ts"]);
  const untouched = nodes().filter((n) => n.path === "keep.ts");
  parsed.length = 0;
  await writeFile(join(root, "main.ts"), "function after() {}");
  await until(() => revision() === 2);
  assert.deepEqual(parsed, ["main.ts"]);
  assert.deepEqual(
    nodes().filter((n) => n.path === "keep.ts"),
    untouched,
  );
  assert.ok(nodes().some((n) => n.name === "after"));
  assert.ok(!nodes().some((n) => n.name === "before"));
  await writeFile(join(root, "added.ts"), "function added() {}");
  await until(() => revision() === 3);
  assert.deepEqual(parsed, ["main.ts", "added.ts"]);
  parsed.length = 0;
  await rename(join(root, "added.ts"), join(root, "renamed.ts"));
  await until(
    () =>
      nodes().some((n) => n.path === "renamed.ts") &&
      !nodes().some((n) => n.path === "added.ts"),
  );
  assert.deepEqual(parsed, ["renamed.ts"]);
  parsed.length = 0;
  await rm(join(root, "renamed.ts"));
  await until(() => !nodes().some((n) => n.path === "renamed.ts"));
  assert.deepEqual(parsed, []);
  const before = revision();
  await writeFile(join(root, "main.ts"), "function after() {}");
  await setTimeout(200);
  assert.equal(revision(), before);
  assert.deepEqual(parsed, []);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.deepEqual(errors, []);
});

test("reconciles saves made during initial capture before exposing the live index", async (t) => {
  let changed = false;
  const setup = await fixture(
    t,
    { "main.ts": "function first() {}" },
    (root) => ({
      parse: (path, source) => {
        if (!changed) {
          changed = true;
          writeFileSync(join(root, path), "function latest() {}");
        }
        return parseFile(path, source);
      },
    }),
  );
  assert.ok(setup.nodes().some((n) => n.name === "latest"));
  assert.equal(setup.revision(), 2);
});

test("re-resolves unchanged consumers after export/symbol edits, target deletion, addition, and rename", async (t) => {
  const { root, db, parsed, nodes, errors } = await fixture(t, {
    "lib.ts": "function first() {} function second() {} export {first as run};",
    "barrel.ts": "export {run} from './lib';",
    "main.ts": "import {run} from './barrel'; function caller() { run(); }",
  });
  const calls = () =>
    db
      .prepare(
        "SELECT target.name FROM edges e JOIN nodes target ON target.id = e.target_id AND target.project_id = e.project_id WHERE e.kind = 'CALLS' ORDER BY target.name",
      )
      .all()
      .map((n) => n.name);
  assert.deepEqual(calls(), ["first"]);
  const consumer = nodes().filter((n) => n.path === "main.ts");
  parsed.length = 0;
  await writeFile(
    join(root, "lib.ts"),
    "function first() {} function second() {} export {second as run};",
  );
  await until(() => calls()[0] === "second");
  assert.deepEqual(parsed, ["lib.ts"]);
  assert.deepEqual(
    nodes().filter((n) => n.path === "main.ts"),
    consumer,
  );
  await rm(join(root, "lib.ts"));
  await until(() => !nodes().some((n) => n.path === "lib.ts"));
  assert.deepEqual(calls(), []);
  assert.ok(
    db
      .prepare("SELECT id FROM diagnostics WHERE code = 'unresolved-module'")
      .get(),
  );
  await writeFile(join(root, "lib.ts"), "export function run() {}");
  await until(() => calls()[0] === "run");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM diagnostics").get().n, 0);
  await rename(join(root, "lib.ts"), join(root, "renamed.ts"));
  await until(() => !nodes().some((n) => n.path === "lib.ts"));
  assert.deepEqual(calls(), []);
  await writeFile(join(root, "barrel.ts"), "export {run} from './renamed';");
  await until(() => calls()[0] === "run");
  await writeFile(
    join(root, "main.ts"),
    "import {run} from './missing'; function caller() { run(); }",
  );
  await until(() => calls().length === 0);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.deepEqual(errors, []);
});
