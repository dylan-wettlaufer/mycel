import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { openDatabase, resolveDatabasePath } from "../dist/index.js";

const run = promisify(execFile);

test(
  "creates private source and WAL files and repairs legacy modes on reopen",
  { skip: process.platform === "win32" },
  async (t) => {
    const dir = await realpath(
      await mkdtemp(join(tmpdir(), "mycel-permissions-")),
    );
    t.after(() => rm(dir, { recursive: true, force: true }));
    const projectRoot = join(dir, "project");
    await mkdir(projectRoot);
    const databasePath = join(dir, "data", "index.sqlite");
    const options = { projectRoot, databasePath };
    const first = openDatabase(options);
    try {
      const files = [
        databasePath,
        databasePath + "-shm",
        databasePath + "-wal",
      ];
      for (const file of files) {
        assert.equal((await stat(file)).mode & 0o777, 0o600);
        await chmod(file, 0o644);
      }
      await chmod(join(dir, "data"), 0o755);
      const second = openDatabase(options);
      second.close();
      for (const file of files)
        assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.equal((await stat(join(dir, "data"))).mode & 0o777, 0o755);
    } finally {
      first.close();
    }
    await symlink(join(dir, "data"), join(dir, "alias"), "dir");
    assert.throws(
      () => resolveDatabasePath(projectRoot, join(dir, "alias")),
      /symbolic links/,
    );
  },
);

test(
  "upgrades permissions inside default storage while retaining its contents",
  { skip: process.platform === "win32" },
  async (t) => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "mycel-managed-storage-")),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const projectRoot = join(directory, "project");
    const fixtureHome = join(directory, "home");
    await mkdir(projectRoot);
    await mkdir(fixtureHome);

    const dbModule = new URL("../dist/index.js", import.meta.url).href;
    const openManaged = async () => {
      const { stdout } = await run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
            import { openDatabase, resolveDatabasePath } from ${JSON.stringify(dbModule)};
            const [projectRoot] = process.argv.slice(1);
            const database = openDatabase({ projectRoot });
            database.exec("CREATE TABLE IF NOT EXISTS preserved(value INTEGER)");
            database.exec("INSERT INTO preserved VALUES (1)");
            console.log(JSON.stringify({
              path: resolveDatabasePath(projectRoot),
              writes: database.prepare("SELECT count(*) FROM preserved").pluck().get(),
            }));
            database.close();
          `,
          projectRoot,
        ],
        {
          env: {
            ...process.env,
            HOME: fixtureHome,
            XDG_DATA_HOME: join(fixtureHome, "xdg"),
          },
        },
      );
      return JSON.parse(stdout);
    };

    const first = await openManaged();
    assert.equal(first.writes, 1);
    const projects = dirname(first.path);
    const storage = dirname(projects);
    const parent = dirname(storage);
    await chmod(parent, 0o755);
    for (const [path, mode] of [
      [storage, 0o700],
      [projects, 0o700],
      [first.path, 0o600],
    ]) {
      assert.equal((await stat(path)).mode & 0o777, mode);
      await chmod(path, mode | 0o055);
    }

    assert.deepEqual(await openManaged(), { path: first.path, writes: 2 });
    assert.equal((await stat(parent)).mode & 0o777, 0o755);
    assert.equal((await stat(storage)).mode & 0o777, 0o700);
    assert.equal((await stat(projects)).mode & 0o777, 0o700);
    assert.equal((await stat(first.path)).mode & 0o777, 0o600);
  },
);
