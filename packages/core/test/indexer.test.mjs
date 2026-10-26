import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { openDatabase } from "@mycel/db";
import { discoverSourceFiles, indexRepository } from "../dist/index.js";

const hash = (text) => createHash("sha256").update(text).digest("hex");

async function repository(t, files = {}) {
  const directory = await mkdtemp(join(tmpdir(), "mycel-index-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = await realpath(directory);
  for (const [path, source] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), source);
  }
  return root;
}

function database(t) {
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  return db;
}

const options = (root, db, indexing) => ({
  project: { name: "fixture", root },
  database: db,
  ...(indexing ? { indexing } : {}),
});
const snapshot = (db) =>
  Object.fromEntries(
    ["projects", "revisions", "nodes", "edges", "diagnostics"].map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table}`).all(),
    ]),
  );

test("discovers only supported files and prunes dependency/build directories at any depth", async (t) => {
  const root = await repository(t, {
    "src/main.ts": "",
    "src/View.tsx": "",
    "types/index.d.ts": "",
    ".hidden/source.ts": "",
    "build.ts": "",
    "code.js": "",
    "code.jsx": "",
    "module.mts": "",
    "module.cts": "",
    "upper.TS": "",
    "package.json": "{}",
    "notes.ts.txt": "",
    ...Object.fromEntries(
      [
        "node_modules",
        "dist",
        "build",
        ".git",
        "coverage",
        ".pnpm-store",
        ".next",
      ].flatMap((name) => [
        [`${name}/ignored.ts`, ""],
        [`packages/demo/${name}/ignored.tsx`, ""],
      ]),
    ),
  });
  const result = await discoverSourceFiles(root);
  assert.equal(result.root, root);
  assert.deepEqual(result.paths, [
    ".hidden/source.ts",
    "build.ts",
    "src/View.tsx",
    "src/main.ts",
    "types/index.d.ts",
  ]);
  assert.deepEqual(
    (await discoverSourceFiles(root, { extensions: [".ts"] })).paths,
    [".hidden/source.ts", "build.ts", "src/main.ts", "types/index.d.ts"],
  );
  assert.deepEqual(
    (await discoverSourceFiles(root, { extensions: [] })).paths,
    [],
  );
});

test("root/nested gitignore patterns match Git, including anchors, escapes, and negations", async (t) => {
  const files = {
    ".gitignore": [
      "*.generated.ts",
      "/root-only.ts",
      "ignored/",
      "!ignored/allowed.ts",
      "\\#literal.ts",
    ].join("\n"),
    "root-only.ts": "",
    "keep.ts": "",
    "skip.generated.ts": "",
    "#literal.ts": "",
    "ignored/allowed.ts": "",
    "nested/.gitignore": [
      "!keep.generated.ts",
      "/local.ts",
      "deep/*.ts",
      "!deep/allowed.ts",
    ].join("\n"),
    "nested/keep.generated.ts": "",
    "nested/skip.generated.ts": "",
    "nested/local.ts": "",
    "nested/root-only.ts": "",
    "nested/deep/.gitignore": "!special.ts\n",
    "nested/deep/special.ts": "",
    "nested/deep/allowed.ts": "",
    "nested/deep/hidden.ts": "",
  };
  const root = await repository(t, files);
  const initialized = spawnSync("git", ["init", "-q", root], {
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const candidates = Object.keys(files).filter((path) => path.endsWith(".ts"));
  const checked = spawnSync(
    "git",
    [
      "-c",
      "core.ignoreCase=false",
      "check-ignore",
      "--no-index",
      "--stdin",
      "-z",
    ],
    { cwd: root, input: `${candidates.join("\0")}\0`, encoding: "utf8" },
  );
  assert.ok(checked.status === 0 || checked.status === 1, checked.stderr);
  const ignored = new Set(checked.stdout.split("\0").filter(Boolean));
  const actual = (await discoverSourceFiles(root)).paths;
  assert.deepEqual(
    actual,
    candidates.filter((path) => !ignored.has(path)).sort(),
  );
  assert.ok(actual.includes("nested/keep.generated.ts"));
  assert.ok(actual.includes("nested/deep/special.ts"));
  assert.ok(!actual.includes("ignored/allowed.ts"));
});

test("custom exclusion globs are independent of gitignore and include hidden paths", async (t) => {
  const root = await repository(t, {
    ".gitignore": "ignored.ts\n",
    "ignored.ts": "",
    "main.ts": "",
    "src/main.test.ts": "",
    "src/.secret.ts": "",
    "src/generated/a.ts": "",
    "src/fixtures/a.tsx": "",
    "vendor/a.ts": "",
    "node_modules/a.ts": "",
  });
  const indexing = {
    respectGitignore: false,
    exclude: [
      "**/*.test.ts",
      "src/{generated,fixtures}/**",
      "**/.secret.ts",
      "vendor",
    ],
  };
  assert.deepEqual((await discoverSourceFiles(root, indexing)).paths, [
    "ignored.ts",
    "main.ts",
  ]);
  assert.deepEqual((await discoverSourceFiles(root)).paths, [
    "main.ts",
    "src/.secret.ts",
    "src/fixtures/a.tsx",
    "src/generated/a.ts",
    "src/main.test.ts",
    "vendor/a.ts",
  ]);
});

test("symlinked files/directories and ignore files are not followed", async (t) => {
  const root = await repository(t, { "source.ts": "function local() {}" });
  const outside = await repository(t, {
    "external.ts": "function external() {}",
    ignore: "*.ts\n",
  });
  await symlink(join(outside, "external.ts"), join(root, "alias.ts"));
  await symlink(outside, join(root, "outside"), "dir");
  await symlink(root, join(root, "cycle"), "dir");
  await symlink(join(outside, "ignore"), join(root, ".gitignore"));
  assert.deepEqual((await discoverSourceFiles(root)).paths, ["source.ts"]);
});

test("indexes all discovered files into nodes, lexical containment, hashes, and diagnostics", async (t) => {
  const source =
    "// 🙂\r\nexport function save() { function nested() {} return nested(); }\r\nclass Store { get value(){ return 1; } set value(next){} static open(){} open(){} }\r\n";
  const root = await repository(t, {
    "src/main.ts": source,
    "ui/View.tsx": "export const View = () => <div/>;",
    "broken.ts": "function good() {}\nconst broken = ;",
    "types.d.ts": "export declare function declared(): void;",
    "empty.ts": "",
    "ignored.js": "function no(){}",
  });
  const db = database(t);
  const result = await indexRepository(options(root, db));
  assert.equal(result.revision, 1);
  assert.equal(result.fileCount, 5);
  assert.ok(result.durationMs >= 0);
  const nodes = db
    .prepare("SELECT * FROM nodes ORDER BY path, start_offset, id")
    .all();
  assert.equal(nodes.length, result.fileCount + result.symbolCount);
  assert.equal(new Set(nodes.map((node) => node.id)).size, nodes.length);
  assert.deepEqual(
    nodes.filter((node) => node.kind === "file").map((node) => node.path),
    result.files,
  );
  const mainFile = nodes.find(
    (node) => node.kind === "file" && node.path === "src/main.ts",
  );
  assert.equal(mainFile.content_hash, hash(source));
  assert.equal(mainFile.end_offset, source.length);
  assert.equal(mainFile.end_line, 4);
  assert.equal(mainFile.end_column, 1);
  const save = nodes.find((node) => node.qualified_name === "save");
  const nested = nodes.find((node) => node.qualified_name === "save.nested");
  const edges = db.prepare("SELECT * FROM edges").all();
  assert.ok(
    edges.some(
      (edge) => edge.source_id === mainFile.id && edge.target_id === save.id,
    ),
  );
  assert.ok(
    edges.some(
      (edge) => edge.source_id === save.id && edge.target_id === nested.id,
    ),
  );
  assert.ok(nodes.some((node) => node.qualified_name === "View"));
  assert.ok(nodes.some((node) => node.qualified_name === "good"));
  for (const node of nodes.filter((node) => node.path === "src/main.ts"))
    assert.equal(
      node.content_hash,
      hash(source.slice(node.start_offset, node.end_offset)),
    );
  assert.equal(edges.length, result.edgeCount);
  assert.ok(edges.every((edge) => edge.kind === "CONTAINS"));
  assert.ok(result.diagnosticCount > 0);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM diagnostics WHERE path = 'broken.ts'",
      )
      .get().count,
    result.diagnosticCount,
  );
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.ok(
    nodes.every(
      (node) => node.revision === 1 && node.project_id === result.projectId,
    ),
  );
  const project = db.prepare("SELECT * FROM projects").get();
  assert.equal(project.root, root);
  assert.deepEqual(
    JSON.parse(project.indexing_settings),
    result.project.indexing,
  );
});

test("identities survive line shifts, remain stable on rescans, and differ across projects", async (t) => {
  const source = "function keep() {}\nfunction keep() {}\n";
  const root = await repository(t, { "main.ts": source });
  const db = database(t);
  const first = await indexRepository(options(root, db));
  const original = db
    .prepare(
      "SELECT id, kind, content_hash FROM nodes WHERE project_id = ? ORDER BY id",
    )
    .all(first.projectId);
  assert.equal(new Set(original.map((node) => node.id)).size, original.length);
  await writeFile(join(root, "main.ts"), `// moved\n\n${source}`);
  const second = await indexRepository(options(root, db));
  assert.equal(second.projectId, first.projectId);
  assert.equal(second.revision, 2);
  const moved = db
    .prepare(
      "SELECT id, kind, content_hash FROM nodes WHERE project_id = ? ORDER BY id",
    )
    .all(first.projectId);
  assert.deepEqual(
    moved.map((node) => node.id),
    original.map((node) => node.id),
  );
  assert.deepEqual(
    moved.filter((node) => node.kind !== "file"),
    original.filter((node) => node.kind !== "file"),
  );
  const otherRoot = await repository(t, { "main.ts": source });
  const other = await indexRepository(options(otherRoot, db));
  assert.notEqual(other.projectId, first.projectId);
  const otherIds = new Set(
    db
      .prepare("SELECT id FROM nodes WHERE project_id = ?")
      .all(other.projectId)
      .map((node) => node.id),
  );
  assert.ok(original.every((node) => !otherIds.has(node.id)));
});

test("a full rescan removes deleted/newly ignored files and preserves other projects", async (t) => {
  const root = await repository(t, {
    "keep.ts": "function keep() {}",
    "delete.ts": "function old() {}",
    "ignored.ts": "function ignored(){}",
  });
  const otherRoot = await repository(t, { "other.ts": "function other(){}" });
  const db = database(t);
  const first = await indexRepository(options(root, db));
  const other = await indexRepository(options(otherRoot, db));
  const otherNodes = db
    .prepare("SELECT * FROM nodes WHERE project_id = ?")
    .all(other.projectId);
  await rm(join(root, "delete.ts"));
  await writeFile(join(root, ".gitignore"), "ignored.ts\n");
  const second = await indexRepository(options(root, db));
  assert.equal(second.revision, 2);
  assert.equal(second.projectId, first.projectId);
  assert.deepEqual(second.files, ["keep.ts"]);
  assert.deepEqual(
    db
      .prepare("SELECT DISTINCT path FROM nodes WHERE project_id = ?")
      .all(first.projectId),
    [{ path: "keep.ts" }],
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM nodes WHERE project_id = ?").all(other.projectId),
    otherNodes,
  );
  assert.deepEqual(
    db
      .prepare(
        "SELECT revision FROM revisions WHERE project_id = ? ORDER BY revision",
      )
      .all(first.projectId),
    [{ revision: 1 }, { revision: 2 }],
  );
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("empty and unsupported-only repositories produce valid empty graph revisions", async (t) => {
  const root = await repository(t, { "main.js": "function ignored() {}" });
  const db = database(t);
  const result = await indexRepository(options(root, db));
  assert.equal(result.revision, 1);
  assert.equal(result.fileCount, 0);
  assert.equal(result.symbolCount, 0);
  assert.equal(result.edgeCount, 0);
  assert.equal(result.diagnosticCount, 0);
  assert.deepEqual(result.files, []);
});

test("read/encoding failures preserve the previous graph and project metadata", async (t) => {
  const root = await repository(t, { "main.ts": "function original() {}" });
  const db = database(t);
  await indexRepository(options(root, db));
  const before = snapshot(db);
  await writeFile(join(root, "bad.ts"), Buffer.from([0xff, 0xfe]));
  const input = options(root, db);
  input.project.name = "changed";
  await assert.rejects(
    indexRepository(input),
    /Could not read repository source: bad.ts/,
  );
  assert.deepEqual(snapshot(db), before);
});

test("a database write failure rolls back graph replacement, revision, and metadata", async (t) => {
  const root = await repository(t, { "main.ts": "function original(){}" });
  const db = database(t);
  await indexRepository(options(root, db));
  const before = snapshot(db);
  db.exec(
    "CREATE TRIGGER reject_node BEFORE INSERT ON nodes WHEN NEW.name = 'reject' BEGIN SELECT RAISE(ABORT, 'test write failure'); END",
  );
  await writeFile(join(root, "main.ts"), "function reject(){}");
  const input = options(root, db);
  input.project.name = "changed";
  await assert.rejects(indexRepository(input), /test write failure/);
  assert.deepEqual(snapshot(db), before);
  assert.equal(db.inTransaction, false);
});

test("canonical repository roots share project identities and results persist across reopen", async (t) => {
  const root = await repository(t, { "main.ts": "function sample(){}" });
  const external = await repository(t);
  const alias = join(external, "alias");
  await symlink(root, alias, "dir");
  const databasePath = join(external, "graph.sqlite");
  const db = openDatabase({ projectRoot: root, databasePath });
  t.after(() => {
    if (db.open) db.close();
  });
  const first = await indexRepository(options(root, db));
  const aliased = await indexRepository(options(alias, db));
  assert.equal(aliased.projectId, first.projectId);
  assert.equal(aliased.project.root, root);
  assert.equal(aliased.revision, 2);
  db.close();
  const reopened = openDatabase({ projectRoot: root, databasePath });
  t.after(() => reopened.close());
  assert.equal(
    reopened.prepare("SELECT COUNT(*) AS count FROM nodes").get().count,
    first.fileCount + first.symbolCount,
  );
});

test("invalid settings and malformed exclusion patterns fail without database writes", async (t) => {
  const root = await repository(t, { "main.ts": "function sample(){}" });
  const db = database(t);
  for (const indexing of [
    { extensions: null },
    { exclude: null },
    { respectGitignore: null },
    { extensions: [".js"] },
    { extensions: [".mts"] },
    { exclude: [null] },
    { respectGitignore: "yes" },
    { exclude: ["["] },
  ]) {
    await assert.rejects(indexRepository(options(root, db, indexing)));
  }
  await assert.rejects(
    indexRepository({ ...options(root, db), project: { root, name: "" } }),
    /Project name/,
  );
  await assert.rejects(discoverSourceFiles(join(root, "main.ts")), /directory/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM projects").get().count,
    0,
  );
  assert.equal(
    await readFile(join(root, "main.ts"), "utf8"),
    "function sample(){}",
  );
});

test("rejects writing a project's graph into a database inside that project", async (t) => {
  const firstRoot = await repository(t, { "first.ts": "function first(){}" });
  const secondRoot = await repository(t, {
    "second.ts": "function second(){}",
  });
  const db = openDatabase({
    projectRoot: firstRoot,
    databasePath: join(secondRoot, "graph.sqlite"),
  });
  t.after(() => db.close());
  await indexRepository(options(firstRoot, db));
  const before = snapshot(db);
  await assert.rejects(indexRepository(options(secondRoot, db)), /outside/);
  assert.deepEqual(snapshot(db), before);
});
