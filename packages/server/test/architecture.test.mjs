import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createApp, startIndexedServer } from "../dist/index.js";

const execFileAsync = promisify(execFile);

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

const closeServer = (server) =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

function createSseReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function nextEvent(predicate, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      let splitAt = buffer.indexOf("\n\n");
      while (splitAt >= 0) {
        const block = buffer.slice(0, splitAt);
        buffer = buffer.slice(splitAt + 2);
        let eventName = "message";
        const dataLines = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:"))
            dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) {
          const parsed = {
            event: eventName,
            data: JSON.parse(dataLines.join("\n")),
          };
          if (predicate(parsed)) return parsed;
        }
        splitAt = buffer.indexOf("\n\n");
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Timed out waiting for SSE event. Buffer: ${buffer}`);
      }
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Timed out reading SSE stream")),
            remaining,
          ),
        ),
      ]);
      if (chunk.done) throw new Error("SSE stream ended before expected event");
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }

  return {
    nextEvent,
    cancel: () => reader.cancel(),
  };
}

test("architecture route validates parameters and handles unavailable and failing queries", async () => {
  assert.equal((await createApp().request("/api/architecture")).status, 503);

  const calls = [];
  const shutdown = new AbortController();
  const app = createApp({
    architecture: {
      signal: shutdown.signal,
      onUpdate: () => () => {},
      async getArchitecture(options) {
        calls.push(options);
        return {
          projectId: "p",
          revision: 1,
          source: "folder-fallback",
          parts: [],
          connections: [],
          changes: {
            available: false,
            reason: "not-a-git-repo",
            requestedWindow: options?.window ?? "branch",
            resolvedWindow: options?.window ?? "branch",
            branch: null,
            baseRef: null,
            baseCommit: null,
            addedFiles: [],
            modifiedFiles: [],
            deletedFiles: [],
            uncommittedFiles: [],
          },
          unassignedFiles: [],
          tieWarnings: [],
        };
      },
    },
  });

  const defaultRes = await app.request("/api/architecture");
  assert.equal(defaultRes.status, 200);
  assert.deepEqual(calls.at(-1), { evidenceLimit: 100 });

  const customRes = await app.request(
    "/api/architecture?window=30d&evidenceLimit=25",
  );
  assert.equal(customRes.status, 200);
  assert.deepEqual(calls.at(-1), { window: "30d", evidenceLimit: 25 });

  for (const query of [
    "window=90d",
    "window=",
    "window=branch&window=7d",
    "evidenceLimit=0",
    "evidenceLimit=501",
    "evidenceLimit=abc",
    "evidenceLimit=10&evidenceLimit=20",
    "component=",
    "component=engine&component=api",
    "component=engine:child",
  ]) {
    assert.equal(
      (await app.request(`/api/architecture?${query}`)).status,
      400,
      query,
    );
  }

  const failingApp = createApp({
    architecture: {
      signal: shutdown.signal,
      onUpdate: () => () => {},
      async getArchitecture() {
        throw new Error("secret internal failure");
      },
    },
  });
  const failRes = await failingApp.request("/api/architecture");
  assert.equal(failRes.status, 500);
  assert.deepEqual(await failRes.json(), {
    error: "Architecture query failed",
  });
});

test("GET /api/architecture serves fallback, agent file, invalid file fallback, and live SSE updates for file, index, and git changes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mycel-arch-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "repo");
  await mkdir(root);
  await git(root, ["init", "-b", "main"]);

  await writeFiles(root, {
    "package.json": { name: "demo", workspaces: ["packages/*"] },
    "packages/server/package.json": {
      name: "@demo/server",
      description: "API server.",
      exports: { ".": "./src/index.ts" },
    },
    "packages/server/src/index.ts": [
      'import { runCore } from "@demo/core";',
      "export function serve() { return runCore(); }",
      "",
    ].join("\n"),
    "packages/core/package.json": {
      name: "@demo/core",
      description: "Core logic.",
      exports: { ".": "./src/index.ts" },
    },
    "packages/core/src/index.ts": "export function runCore() { return 1; }\n",
  });

  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"], "2026-10-01T12:00:00Z");
  await git(root, ["checkout", "-b", "feat/arch"]);

  const server = await startIndexedServer(0, {
    project: { name: "demo", root },
    databasePath: join(dir, "graph.sqlite"),
  });
  t.after(async () => {
    if (server.listening) {
      server.closeAllConnections();
      await closeServer(server);
    }
  });

  const url = `http://127.0.0.1:${server.address().port}`;

  // 1. Initial fallback architecture over HTTP.
  const initialRes = await fetch(
    `${url}/api/architecture?window=branch&evidenceLimit=1`,
  );
  assert.equal(initialRes.status, 200);
  const initial = await initialRes.json();
  assert.equal(initial.source, "folder-fallback");
  assert.equal(initial.changes.resolvedWindow, "branch");
  assert.equal(initial.changes.branch, "feat/arch");
  assert.deepEqual(
    initial.parts.map((part) => [part.id, part.change.status]),
    [
      ["core", "unchanged"],
      ["server", "unchanged"],
    ],
  );
  assert.equal(initial.connections.length, 1);
  assert.equal(initial.connections[0].id, "server->core");
  assert.equal(initial.connections[0].count, 2);
  assert.equal(initial.connections[0].evidence.length, 1);
  assert.equal(initial.connections[0].truncated, true);

  // Open SSE stream for live architecture events.
  const eventsRes = await fetch(`${url}/api/events`, {
    headers: { "Last-Event-ID": "999999" },
  });
  assert.equal(eventsRes.status, 200);
  const sse = createSseReader(eventsRes);
  t.after(() => sse.cancel());

  // 2. Writing `.mycel/architecture.json` triggers a `file` SSE event and switches source to `agent`.
  await writeFiles(root, {
    ".mycel/architecture.json": {
      version: 1,
      source: "agent",
      generatedAt: "2026-11-18T22:00:00-05:00",
      parts: [
        {
          id: "api",
          name: "API service",
          purpose: "Serves HTTP traffic.",
          kind: "service",
          paths: ["packages/server/**"],
        },
        {
          id: "engine",
          name: "Engine",
          purpose: "Runs core logic.",
          kind: "library",
          paths: ["packages/core/**"],
        },
      ],
    },
  });

  const fileEvent = await sse.nextEvent(
    (msg) => msg.event === "architecture" && msg.data.reason === "file",
  );
  assert.equal(fileEvent.data.projectId, initial.projectId);

  const agentMap = await (await fetch(`${url}/api/architecture`)).json();
  assert.equal(agentMap.source, "agent");
  assert.equal(agentMap.generatedAt, "2026-11-18T22:00:00-05:00");
  assert.deepEqual(
    agentMap.parts.map((part) => part.id),
    ["api", "engine"],
  );
  assert.equal(agentMap.connections[0].id, "api->engine");

  // 3. Invalid `.mycel/architecture.json` falls back gracefully with `fileIssues`.
  await writeFiles(root, { ".mycel/architecture.json": "{ invalid json" });
  await sse.nextEvent(
    (msg) => msg.event === "architecture" && msg.data.reason === "file",
  );
  const invalidMap = await (await fetch(`${url}/api/architecture`)).json();
  assert.equal(invalidMap.source, "folder-fallback");
  assert.ok(Array.isArray(invalidMap.fileIssues));
  assert.equal(invalidMap.fileIssues.length, 1);

  // 4. Editing a TypeScript source file triggers an `index` SSE event and marks part changed + uncommitted.
  await writeFiles(root, {
    "packages/core/src/index.ts": "export function runCore() { return 2; }\n",
  });
  const indexEvent = await sse.nextEvent(
    (msg) => msg.event === "architecture" && msg.data.reason === "index",
  );
  assert.ok(indexEvent.data.revision > initial.revision);

  const afterEdit = await (
    await fetch(`${url}/api/architecture?window=uncommitted`)
  ).json();
  const coreAfterEdit = afterEdit.parts.find((part) => part.id === "core");
  assert.equal(coreAfterEdit.change.status, "changed");
  assert.equal(coreAfterEdit.change.uncommitted, true);

  // 5. Committing changes triggers a `git` SSE event and clears uncommitted highlight.
  await git(root, ["add", "packages/core/src/index.ts"]);
  await git(root, ["commit", "-m", "update core"], "2026-11-18T22:05:00Z");
  await sse.nextEvent(
    (msg) => msg.event === "architecture" && msg.data.reason === "git",
  );

  const afterCommit = await (
    await fetch(`${url}/api/architecture?window=branch`)
  ).json();
  const coreAfterCommit = afterCommit.parts.find((part) => part.id === "core");
  assert.equal(coreAfterCommit.change.status, "changed");
  assert.equal(coreAfterCommit.change.uncommitted, false);
});

test("component scope keeps ownership, boundary evidence, and git changes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mycel-component-api-"));
  const root = join(dir, "repo");
  await mkdir(root);
  await git(root, ["init", "-b", "main"]);
  await writeFiles(root, {
    "engine/run.ts":
      'import { read } from "./capture/read";\nimport { save } from "./storage/save";\nexport function run() { return save(read()); }\n',
    "engine/capture/read.ts": "export function read() { return 1; }\n",
    "engine/capture/legacy.ts": "export const legacy = 1;\n",
    "engine/legacy/entry.ts":
      'import { run } from "../run";\nexport const entry = run();\n',
    "engine/misc.ts":
      'import { run } from "./run";\nexport const entry = run();\n',
    "engine/storage/save.ts":
      'import { log } from "../../logger/log";\nexport function save(value: number) { return log(value); }\n',
    "logger/log.ts": "export function log(value: number) { return value; }\n",
    ".mycel/architecture.json": {
      version: 1,
      parts: [
        {
          id: "engine",
          name: "Engine",
          kind: "library",
          purpose: "Coordinates work.",
          paths: ["engine/**"],
          subcomponents: [
            {
              id: "updates",
              name: "Index updates",
              purpose: "Runs updates.",
              paths: [
                "engine/*.ts",
                "engine/storage/**",
                "engine/capture/*.ts",
              ],
            },
            {
              id: "capture",
              name: "Source capture",
              purpose: "Reads source.",
              paths: ["engine/capture/read.ts", "engine/capture/legacy.ts"],
            },
          ],
        },
        {
          id: "storage",
          name: "Storage",
          kind: "data",
          purpose: "Persists records.",
          paths: ["engine/storage/**", "engine/misc.ts"],
        },
        {
          id: "logger",
          name: "Logger",
          kind: "library",
          purpose: "Logs records.",
          paths: ["logger/**"],
        },
      ],
    },
  });
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);
  await rm(join(root, "engine/capture/legacy.ts"));
  const server = await startIndexedServer(0, {
    project: { name: "component", root },
    databasePath: join(dir, "graph.sqlite"),
  });
  t.after(async () => {
    server.closeAllConnections();
    await closeServer(server);
    await rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/api/architecture`;
  const response = await fetch(`${url}?component=engine&window=uncommitted`);
  assert.equal(response.status, 200);
  const map = await response.json();
  assert.deepEqual(map.component, { id: "engine", name: "Engine" });
  assert.deepEqual(
    map.parts.map(({ id, files, boundary }) => [id, files, Boolean(boundary)]),
    [
      ["engine:updates", ["engine/run.ts"], false],
      ["engine:capture", ["engine/capture/read.ts"], false],
      ["engine::other", ["engine/legacy/entry.ts"], false],
      ["storage", ["engine/misc.ts", "engine/storage/save.ts"], true],
    ],
  );
  assert.equal(map.changes.requestedWindow, "uncommitted");
  assert.equal(
    map.parts.find(({ id }) => id === "engine:capture").change.status,
    "changed",
  );
  assert.equal(
    map.parts.find(({ id }) => id === "engine:capture").change.uncommitted,
    true,
  );
  assert.deepEqual(
    map.connections.map(({ id }) => id),
    [
      "engine::other->engine:updates",
      "engine:updates->engine:capture",
      "engine:updates->storage",
      "storage->engine:updates",
    ],
  );
  const external = map.connections.find(
    ({ id }) => id === "engine:updates->storage",
  );
  assert.equal(external.importCount, 1);
  assert.equal(external.callCount, 1);
  assert.ok(
    external.evidence.some(
      ({ kind, file, line, symbol }) =>
        kind === "call" &&
        file === "engine/run.ts" &&
        line === 3 &&
        symbol === "save",
    ),
  );
  assert.equal((await fetch(`${url}?component=storage`)).status, 404);
  const top = await (await fetch(url)).json();
  assert.deepEqual(
    top.parts.map(({ id }) => id),
    ["engine", "storage", "logger"],
  );
});
