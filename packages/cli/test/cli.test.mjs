import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { launchDashboard, resolveRepository } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const binary = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

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
  await writeFile(join(webDistPath, "index.html"), '<!doctype html><div id="root">Mycel</div>');
  return webDistPath;
}

function closeAfter(t, server) {
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
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
  assert.deepEqual(await resolveRepository(root), { name: basename(root), root });
});

test("resolves linked Git worktrees as their own repository roots", async (t) => {
  const { root } = await repository(t);
  await execFileAsync("git", ["-C", root, "-c", "user.name=Mycel Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "fixture"]);
  const worktree = join(await fixture(t), "worktree");
  await execFileAsync("git", ["-C", root, "worktree", "add", "-qb", "test-worktree", worktree]);
  const nested = join(worktree, "src");
  await mkdir(nested);
  assert.deepEqual(await resolveRepository(nested), { name: "worktree", root: worktree });
});

test("rejects missing directories and files", async (t) => {
  const root = await fixture(t);
  await assert.rejects(resolveRepository(join(root, "missing")), { code: "ENOENT" });
  const file = join(root, "file.ts");
  await writeFile(file, "export {};");
  await assert.rejects(resolveRepository(file), /Not a directory/);
});

test("starts the dashboard and selected project before opening the browser", async (t) => {
  const { root, nested } = await repository(t);
  const webDistPath = await dashboardFixture(t);
  let openedUrl;
  let checkedDashboard = false;
  const running = await launchDashboard({
    cwd: nested,
    webDistPath,
    openBrowser: async (url) => {
      openedUrl = url;
      const health = await fetch(`${url}/api/health`);
      assert.deepEqual(await health.json(), { status: "ok" });
      const response = await fetch(`${url}/api/project`);
      assert.deepEqual(await response.json(), { name: basename(root), root });
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
    openBrowser: async () => { throw new Error("No browser available"); },
  });
  closeAfter(t, running.server);
  assert.match(warning.mock.calls[0].arguments[0], /Open http:\/\/127\.0\.0\.1:\d+ manually/);
  assert.equal((await fetch(`${running.url}/api/health`)).status, 200);
});

test("reports a missing frontend build without opening a browser", async (t) => {
  const openBrowser = t.mock.fn();
  await assert.rejects(launchDashboard({
    cwd: await fixture(t),
    webDistPath: await fixture(t),
    openBrowser,
  }), /Dashboard build not found.*pnpm build/);
  assert.equal(openBrowser.mock.callCount(), 0);
});

test("the executable starts from the caller's repository and shuts down on SIGTERM", { timeout: 15_000 }, async (t) => {
  const { root, nested } = await repository(t);
  const child = spawn(process.execPath, [binary, "--no-open"], {
    cwd: nested,
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const exit = once(child, "exit");
  let output = "";
  let errors = "";
  child.stderr.on("data", chunk => { errors += chunk; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CLI did not start: ${errors}`)), 8000);
    child.stdout.on("data", chunk => {
      output += chunk;
      const match = output.match(/Dashboard: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`CLI exited with ${code}: ${errors}`));
    });
  });
  assert.ok(output.includes(`Repository: ${root}`));
  const project = await fetch(`${url}/api/project`);
  assert.deepEqual(await project.json(), { name: basename(root), root });
  assert.equal((await fetch(url)).status, 200);

  child.kill("SIGTERM");
  const [code, signal] = await exit;
  assert.equal(code, 0);
  assert.equal(signal, null);
  await assert.rejects(fetch(`${url}/api/health`));
});

test("help and version work without launching, and obsolete subcommands are rejected", async (t) => {
  const cwd = await fixture(t);
  const help = await execFileAsync(process.execPath, [binary, "--help"], { cwd });
  assert.match(help.stdout, /Usage: mycel \[options\]/);
  assert.doesNotMatch(help.stdout, /mycel web/);
  const version = await execFileAsync(process.execPath, [binary, "--version"], { cwd });
  assert.match(version.stdout, /^\d+\.\d+\.\d+\s*$/);
  await assert.rejects(execFileAsync(process.execPath, [binary, "web"], { cwd }), error => {
    assert.match(error.stderr, /Mycel:.*[Uu]nexpected argument/);
    return true;
  });
});
