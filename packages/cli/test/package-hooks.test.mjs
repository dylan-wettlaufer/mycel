import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { resolveDatabasePath } from "@mycel/db";

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

test(
  "a packed CLI replaces stale hooks after a move and leaves npx profiles alone",
  { skip: process.platform === "win32", timeout: 30_000 },
  async (t) => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "mycel packaged hooks ")),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    await run("pnpm", ["pack", "--pack-destination", directory], {
      cwd: packageRoot,
    });
    const tarball = (await readdir(directory)).find((name) =>
      name.endsWith(".tgz"),
    );
    assert.ok(tarball);
    async function install(prefix) {
      const path = join(directory, prefix, "node_modules", "@mycel", "cli");
      await mkdir(path, { recursive: true });
      await run(
        "tar",
        ["-xzf", join(directory, tarball), "--strip-components=1"],
        {
          cwd: path,
        },
      );
      // Internal workspace dependencies are available locally before publishing.
      await symlink(
        join(packageRoot, "node_modules"),
        join(path, "node_modules"),
      );
      return path;
    }

    const [oldInstall, movedInstall, npxInstall] = await Promise.all([
      install("old"),
      install("it's moved"),
      install(join("custom npm cache", "_npx", "941d6e3c")),
    ]);
    const root = join(directory, "repo");
    const home = join(directory, "profile");
    const freshHome = join(directory, "fresh profile");
    await mkdir(root);
    await mkdir(join(freshHome, ".codex"), { recursive: true });
    await mkdir(join(home, ".cursor"), { recursive: true });
    await mkdir(join(home, ".codex"));
    const settings = join(home, ".codex", "hooks.json");
    const cursorSettings = join(home, ".cursor", "hooks.json");
    const environment = (profile) => ({
      ...process.env,
      HOME: profile,
      XDG_DATA_HOME: profile,
      CODEX_HOME: join(profile, ".codex"),
      CLAUDE_CONFIG_DIR: join(profile, ".claude"),
    });

    const launch = (path, profile = home) =>
      run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { pathToFileURL } from "node:url";
           const { launchDashboard } = await import(pathToFileURL(process.argv[1]));
           const { server } = await launchDashboard({
             agentHooks: "enabled",
             openBrowser: async () => {},
           });
           server.close();`,
          join(path, "dist", "launch.js"),
        ],
        { cwd: root, env: environment(profile), timeout: 10_000 },
      );

    await launch(oldInstall);
    const codex = JSON.parse(await readFile(settings, "utf8"));
    const cursor = JSON.parse(await readFile(cursorSettings, "utf8"));
    const custom = { type: "command", command: "my-custom-hook" };
    const old = codex.hooks.PostToolUse[0];
    assert.ok(old.hooks[0].command.includes(oldInstall));
    const staleNpx = old.hooks[0].command.replace(oldInstall, npxInstall);
    old.hooks.push(custom, { type: "command", command: staleNpx });
    cursor.hooks.afterFileEdit.push({ command: custom.command });
    await writeFile(settings, JSON.stringify(codex));
    await writeFile(cursorSettings, JSON.stringify(cursor));
    await rm(oldInstall, { recursive: true });

    await launch(movedInstall);
    const upgraded = await readFile(settings, "utf8");
    const upgradedCursor = await readFile(cursorSettings, "utf8");
    const groups = JSON.parse(upgraded).hooks.PostToolUse;
    assert.deepEqual(groups[0], { ...old, hooks: [custom] });
    assert.equal(groups.length, 2);
    assert.equal(groups[1].hooks.length, 1);
    const command = groups[1].hooks[0].command;
    assert.ok(command.includes(movedInstall.replaceAll("'", "'\"'\"'")));
    assert.deepEqual(JSON.parse(upgradedCursor).hooks.afterFileEdit, [
      { command: custom.command },
      { command: command.replace("agent-hook codex", "agent-hook cursor") },
    ]);
    const hook = run("/bin/sh", ["-c", command], {
      cwd: root,
      env: environment(home),
      timeout: 10_000,
    });
    hook.child.stdin.end("{}");
    await hook;
    await launch(movedInstall);
    assert.equal(await readFile(settings, "utf8"), upgraded);

    await launch(npxInstall);
    assert.equal(await readFile(settings, "utf8"), upgraded);
    assert.equal(await readFile(cursorSettings, "utf8"), upgradedCursor);
    const dataDirectory =
      process.platform === "darwin"
        ? join(home, "Library", "Application Support", "Mycel")
        : join(home, "mycel");
    assert.equal(
      await readFile(
        resolveDatabasePath(root, dataDirectory) + ".agent-hooks",
        "utf8",
      ),
      "",
    );
    await launch(npxInstall, freshHome);
    await assert.rejects(readFile(join(freshHome, ".codex", "hooks.json")), {
      code: "ENOENT",
    });
  },
);
