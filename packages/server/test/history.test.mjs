import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase, commitChangeSet } from "@mycel/db";
import { createHistoryQueries } from "@mycel/core";
import { createApp } from "../dist/index.js";
function fixture(t) {
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  const project = {
    id: "p",
    name: "fixture",
    root: "/fixture",
    indexing: { extensions: [".ts"], exclude: [], respectGitignore: true },
  };
  const node = {
    id: "a",
    projectId: "p",
    kind: "file",
    name: "a.ts",
    qualifiedName: "a.ts",
    path: "a.ts",
    contentHash: "0".repeat(64),
    range: {
      start: 0,
      end: 0,
      startLine: 1,
      endLine: 1,
      startColumn: 1,
      endColumn: 1,
    },
  };
  const listeners = new Set();
  const shutdown = new AbortController();
  const history = createHistoryQueries(
    db,
    "p",
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    shutdown.signal,
  );
  const commit = () => {
    const { events } = commitChangeSet(db, {
      graph: { project, nodes: [node], edges: [], diagnostics: [] },
      sources: new Map([["a.ts", ""]]),
      changes: [
        {
          entityType: "node",
          entityId: "a",
          path: "a.ts",
          action: "created",
          before: null,
          after: node,
        },
      ],
    });
    for (const e of events) for (const f of listeners) f(e);
    return events;
  };
  commit();
  return { app: createApp({ history }), commit, listeners, shutdown };
}
test("changes routes paginate and reject invalid parameters", async (t) => {
  const { app, commit } = fixture(t);
  commit();
  commit();
  const page = await (await app.request("/api/changes?limit=2")).json();
  assert.deepEqual(
    page.items.map((e) => e.id),
    ["3", "2"],
  );
  assert.equal(page.cursor, "2");
  assert.deepEqual(
    (await (await app.request("/api/changes?cursor=2")).json()).items.map(
      (e) => e.id,
    ),
    ["1"],
  );
  for (const query of [
    "limit=0",
    "limit=101",
    "limit=x",
    "cursor=-1",
    "cursor=9007199254740992",
    "cursor=1&cursor=2",
  ])
    assert.equal((await app.request(`/api/changes?${query}`)).status, 400);
  assert.equal((await createApp().request("/api/changes")).status, 503);
});
test("diff route returns source and handles missing or invalid ids", async (t) => {
  const { app } = fixture(t);
  const response = await app.request("/api/changes/1/diff");
  assert.equal(response.status, 200);
  const diff = await response.json();
  assert.equal(diff.afterContent, "");
  assert.equal(diff.beforeContent, null);
  assert.equal((await app.request("/api/changes/999/diff")).status, 404);
  assert.equal((await app.request("/api/changes/abc/diff")).status, 400);
  assert.equal((await createApp().request("/api/changes/1/diff")).status, 503);
});
async function nextChange(reader) {
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error("Stream ended");
    text += decoder.decode(value, { stream: true });
    if (text.includes("event: change") && text.endsWith("\n\n"))
      return JSON.parse(
        text
          .split("\n")
          .find((line) => line.startsWith("data: "))
          .slice(6),
      );
  }
}
test("SSE streams committed changes with ids and removes disconnected subscribers", async (t) => {
  const { app, commit, listeners } = fixture(t);
  const response = await app.request("/api/events");
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  t.after(() => reader.cancel());
  assert.equal((await nextChange(reader)).id, "1");
  commit();
  assert.equal((await nextChange(reader)).id, "2");
  await reader.cancel();
  assert.equal(listeners.size, 0);
  assert.equal((await createApp().request("/api/events")).status, 503);
});
