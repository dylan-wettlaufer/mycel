import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { openDatabase } from "@mycel/db";
import { startIndexedServer } from "@mycel/server";
import { runClaudeCodeHook } from "../dist/agent-hook.js";

async function readChanges(url, expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${url}/api/changes?kind=files`);
    assert.equal(response.status, 200);
    const { items } = await response.json();
    if (items.length >= expected) return items;
    await delay(30);
  }
  assert.fail(`Timed out waiting for ${expected} indexed file changes`);
}

async function receiveAttributionNotice(stream) {
  const decoder = new TextDecoder();
  let body = "";
  for await (const chunk of stream) {
    body += decoder.decode(chunk, { stream: true });
    if (body.includes("event: attribution\n")) return;
  }
  assert.fail("SSE stream ended before the attribution notice");
}

test("Claude hook attribution reaches file Activity, including late and overlapping edits", async (t) => {
  const state = await realpath(
    await mkdtemp(join(tmpdir(), "mycel-agent-state-")),
  );
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mycel-agent-fixture-")),
  );
  t.after(() =>
    Promise.all(
      [root, state].map((path) => rm(path, { recursive: true, force: true })),
    ),
  );
  execFileSync("git", ["init", "-q", root]);
  const databasePath = join(state, "graph.sqlite");
  const original = "export const value = 0;\n";
  const captured = "export const value = 1;\n";
  const files = [
    "write.ts",
    "edit.ts",
    "shared.ts",
    "manual.ts",
    "mismatch.ts",
  ];
  await Promise.all(files.map((path) => writeFile(join(root, path), original)));
  const server = await startIndexedServer(0, {
    project: { name: "demo", root },
    databasePath,
  });
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const url = `http://127.0.0.1:${server.address().port}`;

  function hook(name, session, id, tool, path, content = captured) {
    return runClaudeCodeHook(
      [
        Buffer.from(
          JSON.stringify({
            hook_event_name: name,
            session_id: session,
            tool_use_id: id,
            tool_name: tool,
            tool_input: { file_path: join(root, path), content },
            transcript_path: "/private/transcript.jsonl",
          }),
        ),
      ],
      root,
      databasePath,
    );
  }

  const tools = [
    ["session-one", "write", "Write", "write.ts"],
    ["session-two", "edit", "Edit", "edit.ts"],
    ["session-one", "shared-a", "Write", "shared.ts"],
    ["session-two", "shared-b", "Edit", "shared.ts"],
    ["session-one", "mismatch", "Write", "mismatch.ts"],
  ];
  for (const tool of tools) await hook("PreToolUse", ...tool);
  await hook("PreToolUse", ...tools[0]); // replayed start
  await Promise.all(files.map((path) => writeFile(join(root, path), captured)));

  const pending = await readChanges(url, files.length);
  const byPath = (items, path) => items.find((item) => item.path === path);
  assert.deepEqual(byPath(pending, "write.ts").attribution, {
    status: "unknown",
  });
  assert.equal(byPath(pending, "manual.ts").attribution, undefined);

  const stop = new AbortController();
  t.after(() => stop.abort());
  const stream = await fetch(`${url}/api/events?tail=1`, {
    signal: AbortSignal.any([stop.signal, AbortSignal.timeout(8_000)]),
  });
  assert.equal(stream.status, 200);
  for (const tool of tools.slice(0, -1)) await hook("PostToolUse", ...tool);
  await hook("PostToolUse", ...tools.at(-1), original);
  await hook("PostToolUse", ...tools[0], original); // a replay cannot replace the hash
  await receiveAttributionNotice(stream.body);
  stop.abort();

  const attributed = await readChanges(url, files.length);
  assert.deepEqual(byPath(attributed, "write.ts").attribution, {
    status: "confirmed",
    provider: "claude-code",
    sessionId: "session-one",
  });
  assert.deepEqual(byPath(attributed, "edit.ts").attribution, {
    status: "inferred",
    provider: "claude-code",
    sessionId: "session-two",
  });
  assert.deepEqual(byPath(attributed, "shared.ts").attribution, {
    status: "unknown",
  });
  assert.deepEqual(byPath(attributed, "mismatch.ts").attribution, {
    status: "unknown",
  });
  assert.equal(byPath(attributed, "manual.ts").attribution, undefined);
  const detail = await fetch(
    `${url}/api/changes/${byPath(attributed, "write.ts").id}`,
  );
  assert.deepEqual(
    (await detail.json()).attribution,
    byPath(attributed, "write.ts").attribution,
  );

  await hook("PreToolUse", "session-two", "failed", "Edit", "manual.ts");
  await hook(
    "PostToolUseFailure",
    "session-two",
    "failed",
    "Edit",
    "manual.ts",
  );
  await writeFile(join(root, "manual.ts"), original);
  await writeFile(join(root, "edit.ts"), original);
  const subsequent = await readChanges(url, files.length + 2);
  assert.equal(byPath(subsequent, "edit.ts").attribution, undefined);
  assert.equal(byPath(subsequent, "manual.ts").attribution, undefined);

  await writeFile(join(state, "external.ts"), original);
  await symlink(join(state, "external.ts"), join(root, "linked.ts"));
  await hook("PreToolUse", "session-one", "symlink", "Edit", "linked.ts");
  await hook(
    "PreToolUse",
    "session-one",
    "outside",
    "Edit",
    join("..", "outside.ts"),
  );
  const db = openDatabase({ projectRoot: root, databasePath });
  try {
    const records = db.prepare("SELECT * FROM agent_tool_events").all();
    assert.equal(records.length, tools.length + 1);
    assert.ok(!JSON.stringify(records).includes("transcript.jsonl"));
    assert.ok(!JSON.stringify(records).includes(captured));
  } finally {
    db.close();
  }
});
