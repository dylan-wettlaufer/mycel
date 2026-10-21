import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  migrateDatabase,
  openDatabase,
  resolveDatabasePath,
} from "../dist/index.js";
import { migrations } from "../dist/migrations/index.js";
import { defaultDataDirectory } from "../dist/paths.js";

const settings = {
  extensions: [".ts", ".tsx"],
  exclude: ["dist/**"],
  respectGitignore: true,
};
const hash = createHash("sha256").update("function save() {}").digest("hex");

function memoryDatabase(t) {
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => {
    if (db.open) db.close();
  });
  return db;
}

function insertProject(db, id = "p") {
  db.prepare(
    "INSERT INTO projects (id, name, root, indexing_settings) VALUES (?, ?, ?, ?)",
  ).run(id, "sample", `/repos/${id}`, JSON.stringify(settings));
  const revision = db.prepare(
    "INSERT INTO revisions (project_id, revision) VALUES (?, ?)",
  );
  revision.run(id, 0);
  revision.run(id, 1);
}

function insertNode(db, overrides = {}) {
  const node = {
    projectId: "p",
    id: "save",
    kind: "function",
    name: "save",
    qualifiedName: "save",
    path: "src/save.ts",
    start: 0,
    end: 18,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 19,
    contentHash: hash,
    revision: 1,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO nodes (
    project_id, id, kind, name, qualified_name, path,
    start_offset, end_offset, start_line, start_column, end_line, end_column,
    content_hash, revision
  ) VALUES (
    @projectId, @id, @kind, @name, @qualifiedName, @path,
    @start, @end, @startLine, @startColumn, @endLine, @endColumn,
    @contentHash, @revision
  )`,
  ).run(node);
}

function insertEdge(db, overrides = {}) {
  db.prepare(
    `INSERT INTO edges (project_id, id, source_id, target_id, kind, revision)
    VALUES (@projectId, @id, @sourceId, @targetId, @kind, @revision)`,
  ).run({
    projectId: "p",
    id: "call",
    sourceId: "save",
    targetId: "validate",
    kind: "CALLS",
    revision: 1,
    ...overrides,
  });
}

function insertDiagnostic(db, overrides = {}) {
  db.prepare(
    `INSERT INTO diagnostics (
    project_id, path, start_offset, end_offset, start_line, start_column, end_line, end_column,
    severity, source, code, message, revision
  ) VALUES (
    @projectId, @path, @start, @end, @startLine, @startColumn, @endLine, @endColumn,
    @severity, @source, @code, @message, @revision
  )`,
  ).run({
    projectId: "p",
    path: "src/broken.ts",
    start: 30,
    end: 30,
    startLine: 2,
    startColumn: 1,
    endLine: 2,
    endColumn: 1,
    severity: "error",
    source: "parser",
    code: "missing-syntax",
    message: "Expected }",
    revision: 1,
    ...overrides,
  });
}

async function temporaryProject(t) {
  const temporary = await mkdtemp(join(tmpdir(), "mycel-db-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const directory = await realpath(temporary);
  const projectRoot = join(directory, "repo");
  await mkdir(projectRoot);
  return {
    directory,
    projectRoot,
    databasePath: join(directory, "data", "nested", "graph.sqlite"),
  };
}

test("initializes a strict, indexed schema with foreign keys and a busy timeout", (t) => {
  const db = memoryDatabase(t);
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.equal(db.pragma("busy_timeout", { simple: true }), 5000);
  assert.equal(db.pragma("journal_mode", { simple: true }), "memory");
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, [
    "diagnostics",
    "edges",
    "nodes",
    "projects",
    "revisions",
    "schema_migrations",
  ]);
  for (const table of tables)
    assert.equal(
      db.pragma("table_list").find((row) => row.name === table).strict,
      1,
    );
  for (const [table, expected] of [
    [
      "nodes",
      [
        "nodes_by_path",
        "nodes_by_qualified_name",
        "nodes_by_name",
        "nodes_by_revision",
      ],
    ],
    ["edges", ["edges_by_source", "edges_by_target", "edges_by_revision"]],
    ["diagnostics", ["diagnostics_by_path", "diagnostics_by_revision"]],
  ]) {
    const indexes = db.pragma(`index_list('${table}')`).map((row) => row.name);
    for (const name of expected) assert.ok(indexes.includes(name), name);
  }
  assert.equal(
    db.prepare("SELECT version FROM schema_migrations").get().version,
    1,
  );
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("reapplying migrations preserves metadata and stored graph data", (t) => {
  const db = memoryDatabase(t);
  insertProject(db);
  insertNode(db);
  const before = db.prepare("SELECT * FROM schema_migrations").all();
  assert.equal(migrateDatabase(db), 1);
  assert.equal(migrateDatabase(db), 1);
  assert.deepEqual(db.prepare("SELECT * FROM schema_migrations").all(), before);
  const stored = db.prepare("SELECT * FROM nodes").get();
  assert.equal(stored.content_hash, hash);
  assert.equal(stored.qualified_name, "save");
  assert.deepEqual(
    JSON.parse(
      db.prepare("SELECT indexing_settings FROM projects").get()
        .indexing_settings,
    ),
    settings,
  );
});

test("disk connections enable WAL, create parents, and persist across reopen", async (t) => {
  const paths = await temporaryProject(t);
  const db = openDatabase({ ...paths, busyTimeoutMs: 25 });
  t.after(() => {
    if (db.open) db.close();
  });
  assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(db.pragma("busy_timeout", { simple: true }), 25);
  insertProject(db);
  insertNode(db);
  assert.ok(existsSync(paths.databasePath));
  db.close();
  const reopened = openDatabase(paths);
  t.after(() => reopened.close());
  assert.equal(reopened.prepare("SELECT id FROM nodes").get().id, "save");
  assert.equal(
    reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()
      .count,
    1,
  );
  assert.deepEqual(reopened.pragma("integrity_check"), [
    { integrity_check: "ok" },
  ]);
});

test("failed graph writes roll back nodes and their revision together", (t) => {
  const db = memoryDatabase(t);
  insertProject(db);
  insertNode(db);
  const commit = db.transaction(() => {
    db.prepare(
      "INSERT INTO revisions (project_id, revision) VALUES ('p', 2)",
    ).run();
    insertNode(db, { id: "new", revision: 2 });
    insertEdge(db, { sourceId: "new", targetId: "missing", revision: 2 });
  });
  assert.throws(commit, { code: "SQLITE_CONSTRAINT_FOREIGNKEY" });
  assert.equal(db.inTransaction, false);
  assert.deepEqual(db.prepare("SELECT id FROM nodes").all(), [{ id: "save" }]);
  assert.deepEqual(
    db.prepare("SELECT revision FROM revisions ORDER BY revision").all(),
    [{ revision: 0 }, { revision: 1 }],
  );
});

test("a failed migration batch rolls back DDL and history without losing existing data", (t) => {
  const db = memoryDatabase(t);
  insertProject(db);
  insertNode(db);
  const second = {
    version: 2,
    name: "marker",
    sql: "CREATE TABLE marker(value TEXT) STRICT; INSERT INTO marker VALUES ('ok');",
  };
  const third = {
    version: 3,
    name: "broken",
    sql: "INSERT INTO missing_table VALUES (1)",
  };
  assert.throws(
    () => migrateDatabase(db, [...migrations, second, third]),
    /missing_table/,
  );
  assert.equal(
    db.prepare("SELECT name FROM sqlite_schema WHERE name = 'marker'").get(),
    undefined,
  );
  assert.equal(
    db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()
      .version,
    1,
  );
  assert.equal(db.prepare("SELECT id FROM nodes").get().id, "save");
  assert.equal(db.inTransaction, false);
  assert.equal(migrateDatabase(db, [...migrations, second]), 2);
  assert.equal(db.prepare("SELECT value FROM marker").get().value, "ok");
});

test("first migration failure leaves neither schema nor migration history", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  assert.throws(() =>
    migrateDatabase(db, [
      {
        version: 1,
        name: "broken",
        sql: "CREATE TABLE marker(value TEXT); INVALID SQL",
      },
    ]),
  );
  assert.deepEqual(
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all(),
    [],
  );
});

test("detects edited migration history and refuses newer schemas on reopen", async (t) => {
  const paths = await temporaryProject(t);
  const db = openDatabase(paths);
  t.after(() => {
    if (db.open) db.close();
  });
  insertProject(db);
  insertNode(db);
  assert.throws(
    () =>
      migrateDatabase(db, [
        { ...migrations[0], sql: `${migrations[0].sql}\n-- changed` },
      ]),
    /history mismatch/,
  );
  db.prepare(
    "INSERT INTO schema_migrations (version, name, checksum) VALUES (2, 'future', ?)",
  ).run("0".repeat(64));
  assert.throws(() => migrateDatabase(db), /newer/);
  db.close();
  assert.throws(
    () => openDatabase(paths),
    (error) => {
      assert.match(error.message, /Could not initialize/);
      assert.match(error.cause.message, /newer/);
      return true;
    },
  );
  const raw = new Database(paths.databasePath);
  t.after(() => raw.close());
  raw
    .transaction(() =>
      assert.equal(raw.prepare("SELECT id FROM nodes").get().id, "save"),
    )
    .exclusive();
});

test("validates migration ordering and rejects nested migration transactions", (t) => {
  const db = memoryDatabase(t);
  assert.throws(
    () => migrateDatabase(db, [{ version: 2, name: "gap", sql: "SELECT 1" }]),
    /consecutive/,
  );
  assert.throws(
    () => migrateDatabase(db, [{ version: 1, name: "", sql: "SELECT 1" }]),
    /consecutive/,
  );
  assert.throws(
    db.transaction(() => migrateDatabase(db)),
    /own transaction/,
  );
  assert.equal(db.inTransaction, false);
});

test("foreign keys forbid dangling endpoints and cross-project nodes or revisions", (t) => {
  const db = memoryDatabase(t);
  insertProject(db, "p");
  insertProject(db, "other");
  insertNode(db);
  insertNode(db, { projectId: "other", id: "validate" });
  assert.throws(() => insertEdge(db), { code: "SQLITE_CONSTRAINT_FOREIGNKEY" });
  assert.throws(() => insertNode(db, { projectId: "missing" }), {
    code: "SQLITE_CONSTRAINT_FOREIGNKEY",
  });
  db.prepare(
    "INSERT INTO revisions (project_id, revision) VALUES ('other', 2)",
  ).run();
  assert.throws(() => insertNode(db, { id: "wrong-revision", revision: 2 }), {
    code: "SQLITE_CONSTRAINT_FOREIGNKEY",
  });
  insertNode(db, { id: "validate" });
  insertEdge(db);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM edges").get().count,
    1,
  );
});

test("deleting nodes cleans up edges and deleting a project cascades its graph", (t) => {
  const db = memoryDatabase(t);
  insertProject(db);
  insertProject(db, "other");
  insertNode(db);
  insertNode(db, { id: "validate" });
  insertNode(db, { projectId: "other" });
  insertEdge(db);
  insertDiagnostic(db);
  db.prepare(
    "DELETE FROM nodes WHERE project_id = 'p' AND id = 'validate'",
  ).run();
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM edges").get().count,
    0,
  );
  db.prepare("DELETE FROM projects WHERE id = 'p'").run();
  for (const table of ["nodes", "edges", "diagnostics", "revisions"]) {
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM ${table} WHERE project_id = 'p'`,
        )
        .get().count,
      0,
    );
  }
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM nodes WHERE project_id = 'other'")
      .get().count,
    1,
  );
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("schema constraints reject invalid graph values and malformed settings", (t) => {
  const db = memoryDatabase(t);
  insertProject(db);
  for (const override of [
    { kind: "interface" },
    { contentHash: "not-a-hash" },
    { contentHash: "A".repeat(64) },
    { start: -1 },
    { start: 20, end: 10 },
    { end: 0.5 },
    { end: Number.MAX_SAFE_INTEGER + 1 },
    { startLine: 0 },
    { startLine: 3, endLine: 2 },
    { startColumn: 0 },
    { endColumn: 0 },
    { startColumn: 20, endColumn: 10 },
    { revision: 0 },
    { name: "" },
  ])
    assert.throws(() => insertNode(db, override), /constraint|cannot store/);
  for (const value of [
    "not json",
    "[]",
    "{}",
    '{"extensions":{},"exclude":[],"respectGitignore":true}',
  ]) {
    assert.throws(
      () =>
        db
          .prepare("UPDATE projects SET indexing_settings = ? WHERE id = 'p'")
          .run(value),
      /CHECK constraint/,
    );
  }
  insertNode(db);
  insertNode(db, { id: "validate" });
  assert.throws(
    () => insertEdge(db, { kind: "REFERENCES" }),
    /CHECK constraint/,
  );
  assert.throws(
    () => insertDiagnostic(db, { severity: "info" }),
    /CHECK constraint/,
  );
  assert.throws(
    () => insertDiagnostic(db, { source: "server" }),
    /CHECK constraint/,
  );
  assert.throws(() => insertDiagnostic(db, { end: 29 }), /CHECK constraint/);
});

test("revisions increase per project, cannot be rewritten, and reserve zero for empty graphs", (t) => {
  const db = memoryDatabase(t);
  insertProject(db);
  db.prepare(
    "INSERT INTO revisions (project_id, revision) VALUES ('p', 3)",
  ).run();
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO revisions (project_id, revision) VALUES ('p', 2)")
        .run(),
    /increase monotonically/,
  );
  assert.throws(
    () =>
      db.prepare("UPDATE revisions SET revision = 4 WHERE revision = 3").run(),
    /cannot be updated/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM revisions WHERE revision = 3").run(),
    /only be deleted/,
  );
  assert.throws(() => insertNode(db, { revision: 0 }), /CHECK constraint/);
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO revisions (project_id, revision) VALUES ('p', ?)")
        .run(Number.MAX_SAFE_INTEGER + 1),
    /CHECK constraint/,
  );
});

test("diagnostics can survive parse failure without an associated file node", (t) => {
  const db = memoryDatabase(t);
  insertProject(db);
  insertDiagnostic(db);
  const stored = db
    .prepare(
      "SELECT path, start_offset, end_offset, source, code, message, revision FROM diagnostics",
    )
    .get();
  assert.deepEqual(stored, {
    path: "src/broken.ts",
    start_offset: 30,
    end_offset: 30,
    source: "parser",
    code: "missing-syntax",
    message: "Expected }",
    revision: 1,
  });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM nodes").get().count,
    0,
  );
});

test("default data directories follow macOS, Linux/XDG, and Windows conventions", () => {
  assert.equal(
    defaultDataDirectory("darwin", "/Users/user", {}),
    "/Users/user/Library/Application Support/Mycel",
  );
  assert.equal(
    defaultDataDirectory("linux", "/home/user", {}),
    "/home/user/.local/share/mycel",
  );
  assert.equal(
    defaultDataDirectory("linux", "/home/user", { XDG_DATA_HOME: "/data" }),
    "/data/mycel",
  );
  assert.equal(
    defaultDataDirectory("linux", "/home/user", { XDG_DATA_HOME: "relative" }),
    "/home/user/.local/share/mycel",
  );
  assert.equal(
    defaultDataDirectory("win32", "C:\\Users\\user", {}),
    "C:\\Users\\user\\AppData\\Local\\Mycel",
  );
  assert.equal(
    defaultDataDirectory("win32", "C:\\Users\\user", {
      LOCALAPPDATA: "D:\\Local",
    }),
    "D:\\Local\\Mycel",
  );
});

test("database locations are stable across root symlinks and distinct per repository", async (t) => {
  const paths = await temporaryProject(t);
  const alias = join(paths.directory, "alias");
  await symlink(paths.projectRoot, alias, "dir");
  const dataDirectory = join(paths.directory, "storage");
  const path = resolveDatabasePath(paths.projectRoot, dataDirectory);
  assert.equal(resolveDatabasePath(alias, dataDirectory), path);
  assert.match(path, /projects\/[a-f0-9]{64}\.sqlite$/);
  assert.equal(existsSync(dataDirectory), false);
  const second = join(paths.directory, "other");
  await mkdir(second);
  assert.notEqual(resolveDatabasePath(second, dataDirectory), path);
});

test("rejects database locations inside the repository, including symlinked ancestors", async (t) => {
  const paths = await temporaryProject(t);
  const internal = join(paths.projectRoot, "data", "graph.sqlite");
  assert.throws(
    () =>
      openDatabase({ projectRoot: paths.projectRoot, databasePath: internal }),
    /outside/,
  );
  assert.equal(existsSync(join(paths.projectRoot, "data")), false);
  assert.throws(
    () =>
      resolveDatabasePath(
        paths.projectRoot,
        join(paths.projectRoot, "storage"),
      ),
    /outside/,
  );
  const alias = join(paths.directory, "points-inside");
  await symlink(paths.projectRoot, alias, "dir");
  assert.throws(
    () =>
      openDatabase({
        projectRoot: paths.projectRoot,
        databasePath: join(alias, "data", "graph.sqlite"),
      }),
    /outside/,
  );
  const existing = join(paths.projectRoot, "existing.sqlite");
  await writeFile(existing, "");
  const fileAlias = join(paths.directory, "alias.sqlite");
  await symlink(existing, fileAlias);
  assert.throws(
    () =>
      openDatabase({ projectRoot: paths.projectRoot, databasePath: fileAlias }),
    /outside/,
  );
  assert.equal(existsSync(internal), false);
});

test("invalid connection options fail before creating files", async (t) => {
  const paths = await temporaryProject(t);
  for (const busyTimeoutMs of [-1, 0.5, NaN, Infinity, 0x80000000]) {
    assert.throws(() => openDatabase({ ...paths, busyTimeoutMs }), RangeError);
  }
  assert.throws(
    () => openDatabase({ databasePath: paths.databasePath }),
    /projectRoot/,
  );
  assert.throws(
    () =>
      openDatabase({
        projectRoot: paths.projectRoot,
        databasePath: "relative.sqlite",
      }),
    /absolute/,
  );
  assert.throws(
    () => resolveDatabasePath(paths.projectRoot, "relative"),
    /absolute/,
  );
  assert.equal(existsSync(paths.databasePath), false);
});
