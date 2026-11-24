import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { openIndexedProject } from "@mycel/core";
import { getFileContent, openDatabase, resolveDatabasePath } from "@mycel/db";

import { launchDashboard, resolveRepository } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const binary = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const skillSource = new URL(
  "../skills/mycel-architecture/SKILL.md",
  import.meta.url,
);

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "mycel cli ")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function repository(t) {
  const root = await fixture(t);
  await execFileAsync("git", ["init", "-q", root]);
  const nested = join(root, "src", "nested folder");
  await mkdir(nested, { recursive: true });
  return { root, nested };
}

async function dashboardFixture(t) {
  const webDistPath = await fixture(t);
  await writeFile(
    join(webDistPath, "index.html"),
    '<!doctype html><div id="root">Mycel</div>',
  );
  return webDistPath;
}

async function managedStorage(t, root) {
  const home = await fixture(t);
  const dataDirectory =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support", "Mycel")
      : join(home, process.platform === "win32" ? "Mycel" : "mycel");
  return {
    databasePath: resolveDatabasePath(root, dataDirectory),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_DATA_HOME: home,
      LOCALAPPDATA: home,
    },
  };
}

function closeAfter(t, server) {
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
}

test("resolves Git roots from nested directories and symlinked paths containing spaces", async (t) => {
  const { root, nested } = await repository(t);
  const project = await resolveRepository(nested);
  assert.deepEqual(project, { name: basename(root), root });

  const link = join(await fixture(t), "linked repository");
  await symlink(nested, link, "junction");
  assert.deepEqual(await resolveRepository(link), project);
});

test("uses the current folder outside Git", async (t) => {
  const root = await fixture(t);
  assert.deepEqual(await resolveRepository(root), {
    name: basename(root),
    root,
  });
});

test("resolves linked Git worktrees as their own repository roots", async (t) => {
  const { root } = await repository(t);
  await execFileAsync("git", [
    "-C",
    root,
    "-c",
    "user.name=Mycel Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "fixture",
  ]);
  const worktree = join(await fixture(t), "worktree");
  await execFileAsync("git", [
    "-C",
    root,
    "worktree",
    "add",
    "-qb",
    "test-worktree",
    worktree,
  ]);
  const nested = join(worktree, "src");
  await mkdir(nested);
  assert.deepEqual(await resolveRepository(nested), {
    name: "worktree",
    root: worktree,
  });
});

test("rejects missing directories and files", async (t) => {
  const root = await fixture(t);
  await assert.rejects(resolveRepository(join(root, "missing")), {
    code: "ENOENT",
  });
  const file = join(root, "file.ts");
  await writeFile(file, "export {};");
  await assert.rejects(resolveRepository(file), /Not a directory/);
});

test("starts the dashboard and selected project before opening the browser", async (t) => {
  const { root, nested } = await repository(t);
  const webDistPath = await dashboardFixture(t);
  await writeFile(join(root, "sample.ts"), "export function sample() {}\n");
  let openedUrl;
  let checkedDashboard = false;
  const running = await launchDashboard({
    cwd: nested,
    webDistPath,
    databasePath: ":memory:",
    openBrowser: async (url) => {
      openedUrl = url;
      const health = await fetch(`${url}/api/health`);
      const { status, index } = await health.json();
      assert.equal(status, "ok");
      assert.equal(index.revision, 1);
      assert.equal(index.indexedFiles, 1);
      const response = await fetch(`${url}/api/project`);
      assert.deepEqual(await response.json(), { name: basename(root), root });
      const search = await fetch(`${url}/api/graph/search?q=sample`);
      assert.equal(search.status, 200);
      const results = await search.json();
      const symbol = results.nodes.find((node) => node.name === "sample");
      assert.ok(symbol);
      const details = await fetch(`${url}/api/graph/nodes/${symbol.id}`);
      assert.equal((await details.json()).node.name, "sample");
      const neighborhood = await fetch(
        `${url}/api/graph/nodes/${symbol.id}/neighborhood`,
      );
      assert.equal((await neighborhood.json()).nodes.length, 2);
      const page = await fetch(url);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /id="root"/);
      checkedDashboard = true;
    },
  });
  closeAfter(t, running.server);
  assert.equal(openedUrl, running.url);
  assert.equal(checkedDashboard, true);
  assert.deepEqual(running.project, { name: basename(root), root });
  assert.equal(running.server.address().address, "127.0.0.1");
});

test("keeps the server running and prints a URL when the browser cannot open", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  const running = await launchDashboard({
    cwd: await fixture(t),
    webDistPath: await dashboardFixture(t),
    databasePath: ":memory:",
    openBrowser: async () => {
      throw new Error("No browser available");
    },
  });
  closeAfter(t, running.server);
  assert.match(
    warning.mock.calls[0].arguments[0],
    /Open http:\/\/127\.0\.0\.1:\d+ manually/,
  );
  assert.equal((await fetch(`${running.url}/api/health`)).status, 200);
});

test("reports a missing frontend build without opening a browser", async (t) => {
  const openBrowser = t.mock.fn();
  await assert.rejects(
    launchDashboard({
      cwd: await fixture(t),
      webDistPath: await fixture(t),
      openBrowser,
    }),
    /Dashboard build not found.*pnpm build/,
  );
  assert.equal(openBrowser.mock.callCount(), 0);
});

test(
  "the executable starts from the caller's repository and shuts down on SIGTERM",
  { timeout: 15_000 },
  async (t) => {
    const { root, nested } = await repository(t);
    await writeFile(join(root, "sample.ts"), "export function sample() {}\n");
    const databasePath = resolveDatabasePath(root);
    const child = spawn(
      process.execPath,
      [binary, "--no-open", "--no-agent-hooks"],
      {
        cwd: nested,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exit = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exit;
      }
      await Promise.all(
        ["", "-wal", "-shm"].map((suffix) =>
          rm(`${databasePath}${suffix}`, { force: true }),
        ),
      );
    });
    let output = "";
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`CLI did not start: ${errors}`)),
        8000,
      );
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/Dashboard: (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`CLI exited with ${code}: ${errors}`));
      });
    });
    assert.match(output, /Discovering source files/);
    assert.match(output, /Reading and parsing source \(0\/1\)/);
    assert.ok(output.includes(`Repository: ${root}`));
    const project = await fetch(`${url}/api/project`);
    assert.deepEqual(await project.json(), { name: basename(root), root });
    const search = await fetch(`${url}/api/graph/search?q=sample`);
    assert.equal(search.status, 200);
    assert.ok(
      (await search.json()).nodes.some((node) => node.name === "sample"),
    );
    assert.equal((await fetch(url)).status, 200);

    child.kill("SIGTERM");
    const [code, signal] = await exit;
    assert.equal(code, 0);
    assert.equal(signal, null);
    await assert.rejects(fetch(`${url}/api/health`));
  },
);

test("help and version work without launching, and obsolete subcommands are rejected", async (t) => {
  const cwd = await fixture(t);
  const help = await execFileAsync(process.execPath, [binary, "--help"], {
    cwd,
  });
  assert.match(help.stdout, /Usage: mycel \[options\]/);
  assert.doesNotMatch(help.stdout, /mycel web/);
  const version = await execFileAsync(process.execPath, [binary, "--version"], {
    cwd,
  });
  assert.match(version.stdout, /^\d+\.\d+\.\d+\s*$/);
  await assert.rejects(
    execFileAsync(process.execPath, [binary, "web"], { cwd }),
    (error) => {
      assert.match(error.stderr, /Mycel:.*[Uu]nexpected argument/);
      return true;
    },
  );
});

test("local data commands inspect, clear, and remove only the selected repository index", async (t) => {
  const { root, nested } = await repository(t);
  const { databasePath, env } = await managedStorage(t, root);
  const run = async (action, command = "history") =>
    (
      await execFileAsync(process.execPath, [binary, command, action], {
        cwd: nested,
        env,
      })
    ).stdout;
  assert.match(await run("status"), /No history recorded/);

  const oldSource = `// ${"archived source ".repeat(8_192)}\nexport const value = 1;\n`;
  const currentSource = "export const value = 2;\n";
  const firstPath = join(root, "one.ts");
  const secondPath = join(root, "two.ts");
  await writeFile(firstPath, oldSource);
  await writeFile(secondPath, oldSource);
  const options = { project: { name: basename(root), root }, databasePath };
  const first = await openIndexedProject(options);
  first.close();

  await writeFile(firstPath, currentSource);
  const second = await openIndexedProject(options);
  second.close();

  await rm(secondPath);
  const third = await openIndexedProject(options);
  third.close();
  const { id } = third.project;
  const database = openDatabase({ projectRoot: root, databasePath });
  try {
    assert.equal(getFileContent(database, id, "two.ts", 1).content, oldSource);
    assert.equal(getFileContent(database, id, "two.ts", 2).content, oldSource);
    assert.equal(getFileContent(database, id, "two.ts", 3), undefined);
  } finally {
    database.close();
  }

  const before = await run("status");
  assert.ok(before.includes(databasePath));
  assert.match(before, /Unique source contents: 2/);
  assert.ok(
    before.includes(
      `Stored source bytes (including current files): ${Buffer.byteLength(oldSource + currentSource)}`,
    ),
  );

  const cleared = await run("clear");
  assert.match(cleared, /Cleared recorded history/);
  assert.match(cleared, /Recorded events: 0/);
  assert.match(cleared, /Unique source contents: 1/);
  const bytes = (output) =>
    Number(output.match(/SQLite database bytes: (\d+)/)?.[1]);
  assert.ok(bytes(cleared) > 0 && bytes(cleared) < bytes(before));

  const reopened = openDatabase({ projectRoot: root, databasePath });
  try {
    assert.equal(getFileContent(reopened, id, "two.ts", 1), undefined);
    assert.equal(getFileContent(reopened, id, "one.ts").content, currentSource);
    await assert.rejects(
      run("remove", "project"),
      /Close any running Mycel dashboards/,
    );
    assert.equal(getFileContent(reopened, id, "one.ts").content, currentSource);
  } finally {
    reopened.close();
  }
  const marker = databasePath + ".agent-hooks";
  await writeFile(marker, "");
  assert.match(
    await run("remove", "project"),
    /Removed the local index and history/,
  );
  assert.match(await run("status"), /No history recorded/);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  assert.equal(await readFile(firstPath, "utf8"), currentSource);
});

test("project remove recovers a corrupt index without removing unrelated files", async (t) => {
  const { root, nested } = await repository(t);
  const { databasePath, env } = await managedStorage(t, root);
  const run = (...args) =>
    execFileAsync(process.execPath, [binary, ...args], { cwd: nested, env });
  const source = join(root, "sample.ts");
  const otherIndex = join(dirname(databasePath), "another-project.sqlite");
  const broken = "This is not a SQLite database.\n";
  await mkdir(dirname(databasePath), { recursive: true });
  await writeFile(source, "export const sample = 1;\n");
  await writeFile(databasePath, broken);
  await writeFile(otherIndex, "other index");

  const wal = databasePath + "-wal";
  await link(otherIndex, wal);
  await assert.rejects(run("project", "remove"), /regular, unshared/);
  assert.equal(await readFile(databasePath, "utf8"), broken);
  await rm(wal);
  for (const suffix of ["-wal", "-shm", "-journal", ".agent-hooks"])
    await writeFile(databasePath + suffix, "");

  const { stdout } = await run("project", "remove");
  assert.match(stdout, /Removed the corrupt local index and history/);
  for (const suffix of ["", "-wal", "-shm", "-journal", ".agent-hooks"])
    await assert.rejects(readFile(databasePath + suffix), { code: "ENOENT" });
  assert.equal(await readFile(otherIndex, "utf8"), "other index");
  assert.equal(await readFile(source, "utf8"), "export const sample = 1;\n");
  assert.match((await run("history", "status")).stdout, /No history recorded/);

  const reindexed = await openIndexedProject({
    project: { name: basename(root), root },
    databasePath,
  });
  try {
    assert.equal(reindexed.getIndexProgress().indexedFiles, 1);
  } finally {
    reindexed.close();
  }
});

test("architecture validates the file and diagnoses working-tree assignments", async (t) => {
  const { root, nested } = await repository(t);
  const run = () =>
    execFileAsync(process.execPath, [binary, "architecture"], { cwd: nested });
  await assert.rejects(run(), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /No \.mycel\/architecture\.json in /);
    assert.match(error.stderr, /mycel install-skill/);
    assert.doesNotMatch(error.stderr, /ENOENT/);
    return true;
  });
  await mkdir(join(root, ".mycel"));
  const file = join(root, ".mycel", "architecture.json");
  await writeFile(file, '{"version":1,"parts":[]}');
  await assert.rejects(run(), /parts: Architecture needs/);
  await writeFile(join(root, "one.ts"), "");
  await writeFile(join(root, "two.ts"), "");
  const part = {
    id: "first",
    name: "First",
    purpose: "Runs queries.",
    kind: "app",
    paths: ["one.ts"],
  };
  const map = { version: 1, parts: [part, { ...part, id: "second" }] };
  await writeFile(file, JSON.stringify(map));
  const { stdout } = await run();
  assert.match(stdout, /Unassigned files: 1\s+two\.ts/);
  assert.match(
    stdout,
    /one\.ts: first \(one\.ts\), second \(one\.ts\); winner: first/,
  );
  part.paths.push("missing/**");
  await writeFile(file, JSON.stringify(map));
  await assert.rejects(run(), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /first: missing\/\*\*/);
    return true;
  });
});

test("architecture --component inspects fresh links and reports responsibility ownership", async (t) => {
  const { root, nested } = await repository(t);
  const run = (component) =>
    execFileAsync(
      process.execPath,
      [binary, "architecture", "--component", component],
      { cwd: nested },
    );
  await mkdir(join(root, ".mycel"));
  await mkdir(join(root, "engine", "work"), { recursive: true });
  await writeFile(
    join(root, "app.ts"),
    'import { run } from "./engine/work/run";\nexport function serve() { return run(); }\n',
  );
  await writeFile(
    join(root, "engine/work/run.ts"),
    'import { read } from "./read";\nimport { save } from "../../storage";\nexport function run() { return save(read()); }\n',
  );
  await writeFile(
    join(root, "engine/work/read.ts"),
    "export function read() { return 1; }\n",
  );
  await writeFile(
    join(root, "engine/other.ts"),
    "export const setting = true;\n",
  );
  await writeFile(
    join(root, "storage.ts"),
    "export function save(value: number) { return value; }\n",
  );
  const engine = {
    id: "engine",
    name: "Query engine",
    purpose: "Runs queries.",
    kind: "library",
    paths: ["engine/**"],
  };
  const definition = {
    version: 1,
    parts: [
      engine,
      {
        id: "api",
        name: "API",
        purpose: "Runs requests.",
        kind: "app",
        paths: ["app.ts"],
      },
      {
        id: "storage",
        name: "Storage",
        purpose: "Stores results.",
        kind: "data",
        paths: ["storage.ts"],
      },
    ],
  };
  const path = join(root, ".mycel", "architecture.json");
  await writeFile(path, JSON.stringify(definition));
  const { stdout: initial } = await run("Query engine");
  assert.match(initial, /Query engine \(engine\)/);
  assert.match(initial, /app\.ts:2 → engine\/work\/run\.ts#run \(call, API\)/);
  assert.match(
    initial,
    /engine\/work\/run\.ts:3 → storage\.ts#save \(call, Storage\)/,
  );
  assert.match(
    initial,
    /engine\/work\/run\.ts:3 → engine\/work\/read\.ts#read \(call\)/,
  );
  assert.match(initial, /No breakdown defined/);
  engine.subcomponents = [
    {
      id: "updates",
      name: "Updates",
      purpose: "Runs writes.",
      paths: ["engine/work/run.ts"],
    },
    {
      id: "capture",
      name: "Capture",
      purpose: "Reads input.",
      paths: ["engine/work/*.ts"],
    },
  ];
  await writeFile(path, JSON.stringify(definition));
  const { stdout: report } = await run("engine");
  assert.match(
    report,
    /Updates \(engine:updates, 1 file\) \[opening focus\]\s+engine\/work\/run\.ts/,
  );
  assert.match(
    report,
    /Capture \(engine:capture, 1 file\)\s+engine\/work\/read\.ts/,
  );
  assert.match(report, /Other files: 1\s+engine\/other\.ts/);
  assert.match(
    report,
    /Overlapping responsibilities: 1\s+engine\/work\/run\.ts: .* → engine:updates/,
  );
  engine.subcomponents[0].paths.push("storage.ts");
  await writeFile(path, JSON.stringify(definition));
  await assert.rejects(run("engine"), (error) => {
    assert.equal(error.code, 1);
    assert.match(
      error.stdout,
      /Unmatched responsibility patterns: 1\s+engine:updates: storage\.ts/,
    );
    return true;
  });
});

test("install-skill writes the packaged skill for Codex and Claude Code", async (t) => {
  const { root, nested } = await repository(t);
  const packaged = await readFile(skillSource, "utf8");
  const { stdout } = await execFileAsync(
    process.execPath,
    [binary, "install-skill"],
    { cwd: nested },
  );
  for (const directory of [".agents/skills", ".claude/skills"]) {
    const path = join(directory, "mycel-architecture", "SKILL.md");
    assert.match(
      stdout,
      new RegExp(`Installed ${path.replaceAll(".", "\\.")}`),
    );
    assert.equal(await readFile(join(root, path), "utf8"), packaged);
  }
});
