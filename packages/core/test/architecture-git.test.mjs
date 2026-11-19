import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { openDatabase } from "@mycel/db";
import {
  applyGitChangesToArchitecture,
  assignFilesToParts,
  buildFallbackArchitecture,
  collectGitChanges,
  getArchitectureConnections,
  indexRepository,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function git(cwd, args, date) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
  };
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(root, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(
      fullPath,
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
  }
}

async function createGitFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "mycel-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  return root;
}

test("detects branch split from main and marks new, changed, unchanged, and uncommitted parts and connections", async (t) => {
  const root = await createGitFixture(t);

  await writeFiles(root, {
    "package.json": { name: "shop", workspaces: ["packages/*"] },
    "packages/core/package.json": {
      name: "@shop/core",
      exports: { ".": "./src/index.ts" },
    },
    "packages/core/src/index.ts": [
      'import { loadDb } from "@shop/db";',
      "export function start() { return loadDb(); }",
      "",
    ].join("\n"),
    "packages/db/package.json": {
      name: "@shop/db",
      exports: { ".": "./src/index.ts" },
    },
    "packages/db/src/index.ts": "export function loadDb() { return 1; }\n",
    "packages/parser/package.json": {
      name: "@shop/parser",
      exports: { ".": "./src/index.ts" },
    },
    "packages/parser/src/index.ts":
      "export function parse() { return true; }\n",
    "packages/parser/src/legacy.ts": "export const legacy = true;\n",
    "packages/utils/package.json": {
      name: "@shop/utils",
      exports: { ".": "./src/index.ts" },
    },
    "packages/utils/src/index.ts": [
      'import { loadDb } from "@shop/db";',
      "export function ping() { return loadDb(); }",
      "",
    ].join("\n"),
  });

  await git(root, ["add", "."]);
  const mainCommit = await git(
    root,
    ["commit", "-m", "initial"],
    "2026-10-01T12:00:00Z",
  ).then(() => git(root, ["rev-parse", "HEAD"]));

  // Create feature branch and make committed + uncommitted changes.
  await git(root, ["checkout", "-b", "feat/payments"]);

  await writeFiles(root, {
    "packages/payments/package.json": {
      name: "@shop/payments",
      exports: { ".": "./src/index.ts" },
    },
    "packages/payments/src/index.ts": [
      'import { loadDb } from "@shop/db";',
      "export function charge() { return loadDb(); }",
      "",
    ].join("\n"),
    "packages/core/src/index.ts": [
      'import { loadDb } from "@shop/db";',
      'import { charge } from "@shop/payments";',
      "export function start() { loadDb(); return charge(); }",
      "",
    ].join("\n"),
  });
  await unlink(join(root, "packages/parser/src/legacy.ts"));
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-m", "add payments"], "2026-11-18T12:00:00Z");

  // Add an uncommitted untracked file inside payments and modify core.
  await writeFiles(root, {
    "packages/payments/src/refund.ts":
      "export function refund() { return true; }\n",
    "packages/core/src/index.ts": [
      'import { loadDb } from "@shop/db";',
      'import { charge } from "@shop/payments";',
      "export function start() { loadDb(); return charge(); } // wip",
      "",
    ].join("\n"),
  });

  const database = openDatabase({ databasePath: ":memory:" });
  t.after(() => database.close());

  const indexed = await indexRepository({
    database,
    project: { name: "shop", root },
  });
  const fallback = await buildFallbackArchitecture(root);
  const assignment = assignFilesToParts(fallback, indexed.files);
  const { connections } = getArchitectureConnections(
    database,
    indexed.projectId,
    assignment,
  );

  const gitChanges = await collectGitChanges(root);
  assert.equal(gitChanges.available, true);
  assert.equal(gitChanges.requestedWindow, "branch");
  assert.equal(gitChanges.resolvedWindow, "branch");
  assert.equal(gitChanges.branch, "feat/payments");
  assert.equal(gitChanges.baseRef, "main");
  assert.equal(gitChanges.baseCommit, mainCommit);
  assert.deepEqual(gitChanges.addedFiles, [
    "packages/payments/package.json",
    "packages/payments/src/index.ts",
    "packages/payments/src/refund.ts",
  ]);
  assert.deepEqual(gitChanges.modifiedFiles, ["packages/core/src/index.ts"]);
  assert.deepEqual(gitChanges.deletedFiles, ["packages/parser/src/legacy.ts"]);
  assert.deepEqual(gitChanges.uncommittedFiles, [
    "packages/core/src/index.ts",
    "packages/payments/src/refund.ts",
  ]);

  const annotated = applyGitChangesToArchitecture(
    assignment,
    connections,
    gitChanges,
  );
  const partsById = new Map(annotated.parts.map((part) => [part.id, part]));
  const connsById = new Map(
    annotated.connections.map((conn) => [conn.id, conn]),
  );

  assert.deepEqual(partsById.get("payments")?.change, {
    status: "new",
    uncommitted: true,
    addedFiles: 2,
    modifiedFiles: 0,
    uncommittedFiles: 1,
  });
  assert.deepEqual(partsById.get("core")?.change, {
    status: "changed",
    uncommitted: true,
    addedFiles: 0,
    modifiedFiles: 1,
    uncommittedFiles: 1,
  });
  // Deleting legacy.ts marks parser as changed even though index.ts was untouched.
  assert.deepEqual(partsById.get("parser")?.change, {
    status: "changed",
    uncommitted: false,
    addedFiles: 0,
    modifiedFiles: 0,
    uncommittedFiles: 0,
  });
  assert.deepEqual(partsById.get("db")?.change, {
    status: "unchanged",
    uncommitted: false,
    addedFiles: 0,
    modifiedFiles: 0,
    uncommittedFiles: 0,
  });
  assert.deepEqual(partsById.get("utils")?.change, {
    status: "unchanged",
    uncommitted: false,
    addedFiles: 0,
    modifiedFiles: 0,
    uncommittedFiles: 0,
  });

  // Connections involving the new `payments` part are "new".
  assert.deepEqual(connsById.get("core->payments")?.change, {
    status: "new",
    uncommitted: true,
  });
  assert.deepEqual(connsById.get("payments->db")?.change, {
    status: "new",
    uncommitted: false,
  });
  // Existing connection whose importing file was edited is "changed".
  assert.deepEqual(connsById.get("core->db")?.change, {
    status: "changed",
    uncommitted: true,
  });
  // Untouched connection is "unchanged".
  assert.deepEqual(connsById.get("utils->db")?.change, {
    status: "unchanged",
    uncommitted: false,
  });
});

test("falls back to 7d on main and supports uncommitted, 7d, and 30d windows", async (t) => {
  const root = await createGitFixture(t);

  await writeFiles(root, { "a/one.ts": "export const one = 1;\n" });
  await git(root, ["add", "."]);
  const oldCommit = await git(
    root,
    ["commit", "-m", "old commit"],
    "2026-10-25T12:00:00Z",
  ).then(() => git(root, ["rev-parse", "HEAD"]));

  await writeFiles(root, { "b/two.ts": "export const two = 2;\n" });
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "recent commit"], "2026-11-16T12:00:00Z");

  // Uncommitted edit to a/one.ts and untracked c/three.ts.
  await writeFiles(root, {
    "a/one.ts": "export const one = 10;\n",
    "c/three.ts": "export const three = 3;\n",
  });

  const now = new Date("2026-11-18T12:00:00Z");

  // Default "branch" on main resolves to "7d".
  const onMain = await collectGitChanges(root, { window: "branch", now });
  assert.equal(onMain.available, true);
  assert.equal(onMain.requestedWindow, "branch");
  assert.equal(onMain.resolvedWindow, "7d");
  assert.equal(onMain.branch, "main");
  assert.equal(onMain.baseRef, null);
  assert.equal(onMain.baseCommit, oldCommit);
  assert.deepEqual(onMain.addedFiles, ["b/two.ts", "c/three.ts"]);
  assert.deepEqual(onMain.modifiedFiles, ["a/one.ts"]);
  assert.deepEqual(onMain.uncommittedFiles, ["a/one.ts", "c/three.ts"]);

  // "30d" encompasses both commits (no commit older than 30d).
  const thirtyDays = await collectGitChanges(root, { window: "30d", now });
  assert.equal(thirtyDays.resolvedWindow, "30d");
  assert.equal(thirtyDays.baseCommit, null);
  assert.deepEqual(thirtyDays.addedFiles, [
    "a/one.ts",
    "b/two.ts",
    "c/three.ts",
  ]);
  assert.deepEqual(thirtyDays.modifiedFiles, []);
  assert.deepEqual(thirtyDays.uncommittedFiles, ["a/one.ts", "c/three.ts"]);

  // "uncommitted" shows only working-tree changes.
  const uncommitted = await collectGitChanges(root, {
    window: "uncommitted",
    now,
  });
  assert.equal(uncommitted.resolvedWindow, "uncommitted");
  assert.equal(uncommitted.baseCommit, null);
  assert.deepEqual(uncommitted.addedFiles, ["c/three.ts"]);
  assert.deepEqual(uncommitted.modifiedFiles, ["a/one.ts"]);
  assert.deepEqual(uncommitted.uncommittedFiles, ["a/one.ts", "c/three.ts"]);
});

test("handles non-git directories, unborn repositories, and subdirectory roots safely", async (t) => {
  // 1. Non-git directory.
  const nonGit = await mkdtemp(join(tmpdir(), "mycel-nongit-"));
  t.after(() => rm(nonGit, { recursive: true, force: true }));
  const missing = await collectGitChanges(nonGit);
  assert.equal(missing.available, false);
  assert.equal(missing.reason, "not-a-git-repo");
  assert.deepEqual(missing.addedFiles, []);

  // 2. Unborn git repository (0 commits, untracked + staged files).
  const unborn = await createGitFixture(t);
  await writeFiles(unborn, {
    "src/staged.ts": "export const s = 1;\n",
    "src/untracked.ts": "export const u = 2;\n",
  });
  await git(unborn, ["add", "src/staged.ts"]);
  const unbornChanges = await collectGitChanges(unborn);
  assert.equal(unbornChanges.available, true);
  assert.equal(unbornChanges.baseCommit, null);
  assert.deepEqual(unbornChanges.addedFiles, [
    "src/staged.ts",
    "src/untracked.ts",
  ]);
  assert.deepEqual(unbornChanges.uncommittedFiles, [
    "src/staged.ts",
    "src/untracked.ts",
  ]);

  // 3. Subdirectory project root inside a parent git repository.
  const parent = await createGitFixture(t);
  await writeFiles(parent, {
    "outside/root.ts": "export const r = 1;\n",
    "subproject/src/a.ts": "export const a = 1;\n",
  });
  await git(parent, ["add", "."]);
  await git(parent, ["commit", "-m", "init"], "2026-10-01T12:00:00Z");

  await writeFiles(parent, {
    "outside/root.ts": "export const r = 2;\n",
    "subproject/src/a.ts": "export const a = 2;\n",
    "subproject/src/b.ts": "export const b = 3;\n",
  });
  const subChanges = await collectGitChanges(join(parent, "subproject"), {
    window: "uncommitted",
  });
  assert.equal(subChanges.available, true);
  assert.deepEqual(subChanges.addedFiles, ["src/b.ts"]);
  assert.deepEqual(subChanges.modifiedFiles, ["src/a.ts"]);
  assert.deepEqual(subChanges.uncommittedFiles, ["src/a.ts", "src/b.ts"]);
});

test("collects git changes cleanly on Mycel itself", async () => {
  const changes = await collectGitChanges(repoRoot);
  assert.equal(changes.available, true);
  assert.equal(changes.requestedWindow, "branch");
  assert.ok(changes.branch === null || changes.branch.length > 0);
});
