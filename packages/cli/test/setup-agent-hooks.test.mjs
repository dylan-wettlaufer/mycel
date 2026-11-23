import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setupAgentHooks } from "../dist/setup-agent-hooks.js";

test("automatic setup is idempotent, keeps existing agent settings, and reports a malformed file", async (t) => {
  const home = await realpath(
    await mkdtemp(join(tmpdir(), "mycel-hook-setup-")),
  );
  t.after(() => rm(home, { recursive: true, force: true }));
  const cwd = join(home, "repo");
  const codex = join(home, "custom codex");
  await Promise.all(
    [cwd, codex, join(home, ".cursor"), join(home, ".claude")].map((path) =>
      mkdir(path),
    ),
  );
  const existing = {
    matcher: "Bash",
    hooks: [{ type: "command", command: "existing-hook" }],
  };
  await writeFile(
    join(codex, "hooks.json"),
    JSON.stringify({
      description: "Keep me",
      hooks: { PostToolUse: [existing] },
    }),
  );
  const cursor = join(home, ".cursor", "hooks.json");
  await writeFile(cursor, "{invalid");
  const claude = join(home, ".claude", "settings.json");
  await writeFile(claude, JSON.stringify({ model: "existing" }));
  const env = { CODEX_HOME: codex, PATH: "" };
  const results = await setupAgentHooks(cwd, home, env);
  assert.deepEqual(
    results.map(({ provider, state }) => [provider, state]),
    [
      ["codex", "configured"],
      ["cursor", "error"],
      ["claude-code", "configured"],
    ],
  );
  const first = await readFile(join(codex, "hooks.json"), "utf8");
  const config = JSON.parse(first);
  assert.equal(config.description, "Keep me");
  assert.deepEqual(config.hooks.PostToolUse[0], existing);
  assert.match(
    config.hooks.PostToolUse[1].hooks[0].command,
    /agent-hook codex --managed$/,
  );
  assert.equal(JSON.parse(await readFile(claude, "utf8")).model, "existing");
  assert.equal(await readFile(cursor, "utf8"), "{invalid");
  await setupAgentHooks(cwd, home, env);
  assert.equal(await readFile(join(codex, "hooks.json"), "utf8"), first);
  await assert.rejects(readFile(join(cwd, ".codex", "hooks.json")), {
    code: "ENOENT",
  });
});

test("an existing project Mycel hook is reused without changing its approval", async (t) => {
  const home = await realpath(
    await mkdtemp(join(tmpdir(), "mycel-project-hook-")),
  );
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, "repo");
  await mkdir(join(root, ".codex"), { recursive: true });
  await mkdir(join(home, ".codex"));
  await writeFile(
    join(root, ".codex", "hooks.json"),
    JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: "^apply_patch$",
            hooks: [{ type: "command", command: "mycel agent-hook codex" }],
          },
        ],
      },
    }),
  );
  assert.deepEqual(await setupAgentHooks(root, home, { PATH: "" }), [
    { provider: "codex", state: "configured" },
  ]);
  await assert.rejects(readFile(join(home, ".codex", "hooks.json")), {
    code: "ENOENT",
  });
});
