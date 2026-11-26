import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const windows = process.platform === "win32";
const output = fileURLToPath(new URL("../dist/npm/", import.meta.url));

function npm(args, options) {
  const npmCli = join(
    dirname(process.execPath),
    "node_modules/npm/bin/npm-cli.js",
  );
  return windows
    ? run(process.execPath, [npmCli, ...args], options)
    : run("npm", args, options);
}

function profileEnvironment(profile) {
  return {
    ...process.env,
    HOME: profile,
    USERPROFILE: profile,
    XDG_DATA_HOME: profile,
    LOCALAPPDATA: profile,
    CODEX_HOME: join(profile, ".codex"),
    CLAUDE_CONFIG_DIR: join(profile, ".claude"),
  };
}

async function withDashboard(bin, args, options, verify) {
  const child = spawn(process.execPath, [bin, "--no-open", ...args], {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = once(child, "exit");
  let stdout = "";
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  let timer;
  try {
    const url = await Promise.race([
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Dashboard did not start: ${stderr}`)),
          10_000,
        );
        child.stdout.setEncoding("utf8").on("data", (chunk) => {
          stdout += chunk;
          const match = stdout.match(/Dashboard: (http:\/\/127\.0\.0\.1:\d+)/);
          if (match) resolve(match[1]);
        });
      }),
      exit.then(([code]) => {
        throw new Error(`Dashboard exited with ${code}: ${stderr}`);
      }),
    ]);
    if (verify) await verify(url);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        child.kill("SIGTERM");
        const [code, signal] = await exit;
        if (!windows) assert.deepEqual([code, signal], [0, null], stderr);
      } finally {
        clearTimeout(kill);
      }
    }
  }
}

test(
  "the npm tarball works outside the Mycel checkout",
  { timeout: 240_000 },
  async (t) => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "mycel package ")),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const tarballs = (await readdir(output)).filter((name) =>
      name.endsWith(".tgz"),
    );
    assert.equal(tarballs.length, 1);
    const tarball = join(output, tarballs[0]);
    const prefix = join(directory, "global install");
    const cache = join(directory, "npm cache");
    const project = join(directory, "project");
    const cwd = join(project, "source folder");
    const home = join(directory, "profile");
    await mkdir(cwd, { recursive: true });
    await mkdir(home);
    const options = { cwd, env: profileEnvironment(home), timeout: 120_000 };
    const npmOptions = {
      ...options,
      env: { ...process.env, npm_config_cache: cache },
    };
    const globalArgs = ["--global", "--prefix", prefix];
    await npm(
      ["install", ...globalArgs, "--no-audit", "--no-fund", tarball],
      npmOptions,
    );
    const { stdout: npmRoot } = await npm(["root", ...globalArgs], npmOptions);
    const packageName = "@dylan-wettlaufer/mycel";
    const packageRoot = join(npmRoot.trim(), packageName);
    const manifest = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );
    const bin = join(packageRoot, manifest.bin.mycel);
    assert.equal(manifest.name, packageName);
    assert.equal(manifest.license, "MIT");
    assert.equal(manifest.engines.node, "^22.22.2 || ^24.15.0 || ^26.0.0");
    assert.match(
      await readFile(join(packageRoot, "LICENSE"), "utf8"),
      /^MIT License/,
    );
    assert.match(
      await readFile(join(packageRoot, "README.md"), "utf8"),
      /npm install -g/,
    );
    assert.match(await readFile(bin, "utf8"), /^#!\/usr\/bin\/env node/);
    assert.ok(
      !Object.keys(manifest.dependencies).some((name) =>
        name.startsWith("@mycel/"),
      ),
    );

    const shim = windows
      ? join(prefix, "mycel.cmd")
      : join(prefix, "bin", "mycel");
    const mycel = (arg) =>
      windows
        ? run(
            process.env.ComSpec ?? "cmd.exe",
            ["/d", "/s", "/c", `""${shim}" ${arg}"`],
            {
              ...options,
              windowsVerbatimArguments: true,
            },
          )
        : run(shim, [arg], options);
    assert.equal((await mycel("--version")).stdout.trim(), manifest.version);
    await run("git", ["init", "-q", project], options);
    await Promise.all([
      writeFile(join(project, "sample.ts"), "export function sample() {}\n"),
      writeFile(join(project, "main.py"), "import helper\n"),
      writeFile(join(project, "helper.py"), "value = 42\n"),
    ]);
    await mycel("install-skill");
    const skillPath = join("mycel-architecture", "SKILL.md");
    const skill = await readFile(
      join(packageRoot, "skills", skillPath),
      "utf8",
    );
    for (const agent of [".agents", ".claude"])
      assert.equal(
        await readFile(join(project, agent, "skills", skillPath), "utf8"),
        skill,
      );

    await withDashboard(bin, ["--no-agent-hooks"], options, async (url) => {
      const page = await fetch(url);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /<title>Mycel<\/title>/);
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)];
      assert.ok(assets.some(([, path]) => path.endsWith(".js")));
      assert.ok(assets.some(([, path]) => path.endsWith(".css")));
      for (const [, path] of assets) {
        const asset = await fetch(url + path);
        assert.equal(asset.status, 200, path);
        assert.match(asset.headers.get("content-type"), /javascript|text\/css/);
        await asset.arrayBuffer();
      }
      const { root } = await (await fetch(`${url}/api/project`)).json();
      assert.equal(root, project);
      const { nodes } = await (
        await fetch(`${url}/api/graph/search?q=sample`)
      ).json();
      assert.ok(nodes.some(({ name }) => name === "sample"));
      const { files, dependencies } = await (
        await fetch(`${url}/api/graph/repository`)
      ).json();
      const main = files.find(({ path }) => path === "main.py");
      const helper = files.find(({ path }) => path === "helper.py");
      assert.ok(main && helper);
      assert.ok(
        dependencies.some(
          ({ sourceId, targetId }) =>
            sourceId === main.id && targetId === helper.id,
        ),
      );
    });

    const transient = await npm(
      ["exec", "--yes", `--package=${tarball}`, "--", "mycel", "--version"],
      npmOptions,
    );
    assert.equal(transient.stdout.trim(), manifest.version);

    await t.test(
      "refreshes moved agent hooks and leaves transient npm installs alone",
      { skip: windows },
      async () => {
        const npxCache = join(cache, "_npx");
        const [key] = await readdir(npxCache);
        const npxBin = join(
          npxCache,
          key,
          "node_modules",
          packageName,
          manifest.bin.mycel,
        );
        const settings = join(home, ".codex", "hooks.json");
        const cursorSettings = join(home, ".cursor", "hooks.json");
        await mkdir(dirname(settings));
        await mkdir(dirname(cursorSettings));
        await withDashboard(bin, [], options);
        const codex = JSON.parse(await readFile(settings, "utf8"));
        const cursor = JSON.parse(await readFile(cursorSettings, "utf8"));
        const old = codex.hooks.PostToolUse[0];
        const command = old.hooks[0].command;
        assert.ok(command.includes(bin));
        const custom = { type: "command", command: "my-custom-hook" };
        old.hooks.push(custom, {
          type: "command",
          command: command.replace(bin, npxBin),
        });
        cursor.hooks.afterFileEdit.push({ command: custom.command });
        await writeFile(settings, JSON.stringify(codex));
        await writeFile(cursorSettings, JSON.stringify(cursor));

        const moved = join(directory, "it's moved");
        await rename(prefix, moved);
        const movedBin = join(
          moved,
          "lib",
          "node_modules",
          packageName,
          manifest.bin.mycel,
        );
        await withDashboard(movedBin, [], options);
        const upgraded = await readFile(settings, "utf8");
        const upgradedCursor = await readFile(cursorSettings, "utf8");
        const groups = JSON.parse(upgraded).hooks.PostToolUse;
        assert.deepEqual(groups[0], { ...old, hooks: [custom] });
        assert.equal(groups.length, 2);
        assert.equal(groups[1].hooks.length, 1);
        const movedCommand = groups[1].hooks[0].command;
        assert.ok(movedCommand.includes(movedBin.replaceAll("'", "'\"'\"'")));
        assert.deepEqual(JSON.parse(upgradedCursor).hooks.afterFileEdit, [
          { command: custom.command },
          {
            command: movedCommand.replace(
              "agent-hook codex",
              "agent-hook cursor",
            ),
          },
        ]);
        const hook = run("/bin/sh", ["-c", movedCommand], options);
        hook.child.stdin.end("{}");
        await hook;
        await withDashboard(movedBin, [], options);
        assert.equal(await readFile(settings, "utf8"), upgraded);

        await withDashboard(npxBin, [], options);
        assert.equal(await readFile(settings, "utf8"), upgraded);
        assert.equal(await readFile(cursorSettings, "utf8"), upgradedCursor);
        const freshHome = join(directory, "fresh profile");
        await mkdir(join(freshHome, ".codex"), { recursive: true });
        await withDashboard(npxBin, [], {
          ...options,
          env: profileEnvironment(freshHome),
        });
        await assert.rejects(
          readFile(join(freshHome, ".codex", "hooks.json")),
          { code: "ENOENT" },
        );
      },
    );
  },
);
