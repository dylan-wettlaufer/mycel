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

test("rolls back a failed incremental relationship write and retries the same saved content", async (t) => {
  const { root, db, live, nodes, errors, revision } = await fixture(t, {
    "main.ts":
      "function first() {} function second() {} function caller() {first();}",
    "broken.ts": "const broken = ;",
  });
  const snapshot = () =>
    Object.fromEntries(
      ["projects", "revisions", "nodes", "edges", "diagnostics"].map(
        (table) => [
          table,
          db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ],
      ),
    );
  const before = snapshot();
  db.exec(
    "CREATE TRIGGER reject_edge BEFORE INSERT ON edges WHEN NEW.kind = 'CALLS' BEGIN SELECT RAISE(ABORT, 'relationship write failed'); END",
  );
  await writeFile(
    join(root, "main.ts"),
    "function first() {} function second() {} function caller() {second();}",
  );
  await until(() => errors.length > 0);
  assert.match(errors[0].message, /relationship write failed/);
  assert.deepEqual(snapshot(), before);
  assert.equal(db.inTransaction, false);
  assert.equal(live.lastUpdate, undefined);
  db.exec("DROP TRIGGER reject_edge");
  await live.flush();
  assert.equal(revision(), 2);
  const target = db
    .prepare(
      "SELECT n.name FROM edges e JOIN nodes n ON n.id = e.target_id AND n.project_id = e.project_id WHERE e.kind = 'CALLS'",
    )
    .get();
  assert.equal(target.name, "second");
  assert.deepEqual(snapshot().diagnostics, before.diagnostics);
  assert.deepEqual(
    nodes().filter((n) => n.path === "broken.ts"),
    before.nodes.filter((n) => n.path === "broken.ts"),
  );
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("retains valid nodes and calls through syntax errors and parser exceptions, then recovers", async (t) => {
  const { root, db, live, nodes, revision, errors } = await fixture(
    t,
    {
      "lib.ts": "export function run() {}",
      "main.ts": "import {run} from './lib'; function caller() {run();}",
    },
    {
      parse: (path, source) => {
        if (source === "throw") throw new Error("parser crashed");
        return parseFile(path, source);
      },
    },
  );
  const original = nodes();
  const edges = db.prepare("SELECT * FROM edges ORDER BY id").all();
  for (const [source, expectedRevision] of [
    ["export function run( {", 2],
    ["throw", 3],
  ]) {
    await writeFile(join(root, "lib.ts"), source);
    await until(() => revision() === expectedRevision);
    assert.deepEqual(nodes(), original);
    assert.deepEqual(
      db.prepare("SELECT * FROM edges ORDER BY id").all(),
      edges,
    );
    assert.ok(
      db
        .prepare(
          "SELECT * FROM diagnostics WHERE path = 'lib.ts' AND source = 'parser'",
        )
        .all().length,
    );
    assert.deepEqual(live.lastUpdate.retainedPaths, ["lib.ts"]);
  }
  await writeFile(join(root, "lib.ts"), "export function recovered() {}");
  await until(() => revision() === 4);
  assert.ok(nodes().some((n) => n.name === "recovered"));
  assert.ok(!nodes().some((n) => n.name === "run"));
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM edges WHERE kind = 'CALLS'").get().n,
    0,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM diagnostics WHERE source = 'parser'")
      .get().n,
    0,
  );
  assert.deepEqual(live.lastUpdate.retainedPaths, []);
  await writeFile(join(root, "lib.ts"), "throw");
  await until(() => revision() === 5);
  await rm(join(root, "lib.ts"));
  await until(() => revision() === 6);
  assert.ok(!nodes().some((n) => n.path === "lib.ts"));
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM diagnostics WHERE source = 'parser'")
      .get().n,
    0,
  );
  assert.deepEqual(errors, []);
});

test("indexes recoverable new files and isolates parser exceptions from healthy changes", async (t) => {
  const { root, db, nodes, revision } = await fixture(
    t,
    { "main.ts": "function original() {}" },
    {
      parse: (path, source) => {
        if (source === "throw") throw new Error("parser crashed");
        return parseFile(path, source);
      },
    },
  );
  await writeFile(join(root, "new.ts"), "throw");
  await until(() => revision() === 2);
  assert.ok(!nodes().some((n) => n.path === "new.ts"));
  await writeFile(join(root, "main.ts"), "function healthy() {}");
  await until(() => revision() === 3);
  assert.ok(nodes().some((n) => n.name === "healthy"));
  assert.ok(
    db
      .prepare("SELECT id FROM diagnostics WHERE code = 'parser-failure'")
      .get(),
  );
  await writeFile(
    join(root, "new.ts"),
    "function recovered() {} const invalid = ;",
  );
  await until(() => revision() === 4);
  assert.ok(nodes().some((n) => n.name === "recovered"));
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM diagnostics WHERE code = 'parser-failure'",
      )
      .get().n,
    0,
  );
});

test("exposes timings only for committed updates and includes debounce latency", async (t) => {
  const { root, live, revision } = await fixture(t, {
    "main.ts": "function initial() {}",
  });
  assert.equal(live.lastUpdate, undefined);
  const savedAt = performance.now();
  await writeFile(join(root, "main.ts"), "function saved() {}");
  await until(() => revision() === 2);
  const timing = live.lastUpdate;
  assert.equal(timing.revision, 2);
  assert.deepEqual(timing.changedPaths, ["main.ts"]);
  assert.ok(timing.observedAt >= savedAt);
  assert.ok(timing.completedAt <= performance.now());
  assert.ok(timing.latencyMs > 0);
  assert.ok(timing.queueMs >= 20);
  for (const stage of ["captureMs", "parseMs", "resolveMs", "writeMs"])
    assert.ok(timing[stage] >= 0);
  assert.ok(timing.latencyMs <= timing.completedAt - savedAt);
  await writeFile(join(root, "main.ts"), "function saved() {}");
  await setTimeout(200);
  assert.equal(live.lastUpdate, timing);
});

test("subscribers see committed events only; failures publish nothing and listener errors do not retry", async (t) => {
  const { root, db, live, errors } = await fixture(t, {
    "a.ts": "function a() {}",
  });
  const events = [];
  const off = live.onEvent((e) => {
    assert.ok(db.prepare("SELECT 1 FROM change_events WHERE id = ?").get(e.id));
    events.push(e);
  });
  live.onEvent(() => {
    throw new Error("listener failure");
  });
  db.exec(
    "CREATE TRIGGER reject_history BEFORE INSERT ON change_events BEGIN SELECT RAISE(ABORT, 'reject history'); END",
  );
  await writeFile(join(root, "a.ts"), "function b() {}");
  await until(() => errors.length > 0);
  assert.equal(events.length, 0);
  db.exec("DROP TRIGGER reject_history");
  await live.flush();
  assert.ok(events.length > 0);
  assert.ok(errors.some((e) => e.message === "listener failure"));
  const count = events.length;
  off();
  await writeFile(join(root, "a.ts"), "function c() {}");
  await until(() =>
    db.prepare("SELECT name FROM nodes WHERE name = 'c'").get(),
  );
  assert.equal(events.length, count);
});
