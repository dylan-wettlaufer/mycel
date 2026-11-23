import assert from "node:assert/strict";
import test from "node:test";
import {
  openDatabase,
  commitChangeSet,
  currentRevision,
  getChange,
  listChanges,
} from "../dist/index.js";
const project = {
  id: "p",
  name: "fixture",
  root: "/fixture",
  indexing: { extensions: [".ts"], exclude: [], respectGitignore: true },
};
const node = {
  id: "file",
  projectId: "p",
  kind: "file",
  name: "a.ts",
  qualifiedName: "a.ts",
  path: "a.ts",
  range: {
    start: 0,
    end: 1,
    startLine: 1,
    endLine: 1,
    startColumn: 1,
    endColumn: 2,
  },
  contentHash: "0".repeat(64),
};
export function changeSet() {
  return {
    graph: { project, nodes: [node], edges: [], diagnostics: [] },
    sources: new Map([["a.ts", "a"]]),
    changes: [
      {
        entityType: "node",
        entityId: node.id,
        path: "a.ts",
        action: "created",
        before: null,
        after: node,
      },
    ],
  };
}
test("change sets atomically persist graph, snapshots and events; late failures roll everything back", (t) => {
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  const result = commitChangeSet(db, changeSet());
  assert.equal(result.revision, 1);
  assert.equal(result.events[0].id, "1");
  assert.equal(db.prepare("SELECT content FROM snapshots").get().content, "a");
  db.exec(
    "CREATE TRIGGER fail_event BEFORE INSERT ON change_events BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
  );
  assert.throws(() => commitChangeSet(db, changeSet()), /injected/);
  assert.equal(currentRevision(db, "p"), 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM snapshots").get().n, 1);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM change_events").get().n,
    1,
  );
});

test("history pagination is exclusive, bounded and project scoped", async (t) => {
  const { listChanges } = await import("../dist/index.js");
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  for (let i = 0; i < 4; i++) commitChangeSet(db, changeSet());
  const page = listChanges(db, "p", undefined, 2);
  assert.deepEqual(
    page.items.map((e) => e.id),
    ["4", "3"],
  );
  assert.equal(page.cursor, "3");
  assert.deepEqual(
    listChanges(db, "p", page.cursor, 2).items.map((e) => e.id),
    ["2", "1"],
  );
  assert.equal(listChanges(db, "p", "3", 2).cursor, null);
  assert.deepEqual(listChanges(db, "other").items, []);
  assert.throws(() => listChanges(db, "p", "-1"), /cursor/);
  assert.throws(() => listChanges(db, "p", undefined, 1001), /limit/);
});

test("file activity omits duplicate edits with identical source snapshots before paginating", (t) => {
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  commitChangeSet(db, changeSet());

  const set = changeSet();
  const edited = { ...node, contentHash: "1".repeat(64) };
  set.graph.nodes = [edited];
  set.sources.set(node.path, "edited source");
  set.changes[0] = {
    ...set.changes[0],
    action: "modified",
    before: node,
    after: edited,
  };
  const [edit] = commitChangeSet(db, set).events;
  const [duplicate] = commitChangeSet(db, set).events;

  const page = listChanges(db, "p", undefined, 1, { kind: "files" });
  assert.deepEqual(
    page.items.map(({ id }) => id),
    [edit.id],
  );
  assert.equal(page.cursor, null);
  assert.equal(getChange(db, "p", duplicate.id)?.id, duplicate.id);
});

test("coalesced observations from different agents stay ambiguous even when only the last hash matches", (t) => {
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  commitChangeSet(db, changeSet());
  const record = db.prepare(`INSERT INTO agent_tool_events
    (project_id, provider, session_id, tool_use_id, tool, path, started_at, finished_at,
     outcome, is_observation, observed_hash)
    VALUES ('p', ?, ?, ?, 'Edit', 'a.ts', ?, ?, 'succeeded', 1, ?)`);
  const after = { ...node, contentHash: "2".repeat(64) };
  record.run(
    "cursor",
    "conversation",
    "edit-1",
    10_000,
    10_000,
    "1".repeat(64),
  );
  record.run("codex", "session", "edit-2", 10_025, 10_025, after.contentHash);
  const set = changeSet();
  set.graph.nodes = [after];
  set.changes[0] = {
    ...set.changes[0],
    action: "modified",
    before: node,
    after,
  };
  set.fileCaptureTimes = new Map([["a.ts", 10_050]]);
  const { events } = commitChangeSet(db, set);
  assert.deepEqual(events[0].attribution, { status: "unknown" });
  assert.deepEqual(getChange(db, "p", events[0].id).attribution, {
    status: "unknown",
  });
});
test("replay returns chronological events after an exclusive cursor", async (t) => {
  const { getEventsAfter } = await import("../dist/index.js");
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  for (let i = 0; i < 3; i++) commitChangeSet(db, changeSet());
  assert.deepEqual(
    getEventsAfter(db, "p", "1", 1).map((e) => e.id),
    ["2"],
  );
  assert.deepEqual(getEventsAfter(db, "p", "3"), []);
  assert.deepEqual(getEventsAfter(db, "other", "0"), []);
});
test("diffs reconstruct created modified and deleted source including empty content", async (t) => {
  const { getDiff } = await import("../dist/index.js");
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  const set = changeSet();
  commitChangeSet(db, set);
  set.changes[0] = { ...set.changes[0], action: "modified", before: node };
  set.sources.set("a.ts", "");
  commitChangeSet(db, set);
  set.changes[0] = { ...set.changes[0], action: "deleted", after: null };
  set.graph.nodes = [];
  set.sources.clear();
  commitChangeSet(db, set);
  assert.equal(getDiff(db, "p", "1").beforeContent, null);
  assert.equal(getDiff(db, "p", "2").beforeContent, "a");
  assert.equal(getDiff(db, "p", "2").afterContent, "");
  assert.equal(getDiff(db, "p", "3").beforeContent, "");
  assert.equal(getDiff(db, "p", "3").afterContent, null);
  assert.equal(getDiff(db, "other", "1"), undefined);
});
test("explicit pruning preserves reachable diffs, current source and increasing ids", async (t) => {
  const { pruneHistory, getDiff, listChanges } =
    await import("../dist/index.js");
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  const set = changeSet();
  commitChangeSet(db, set);
  set.changes[0] = { ...set.changes[0], action: "modified", before: node };
  for (let i = 2; i <= 4; i++) {
    set.sources.set("a.ts", String(i));
    commitChangeSet(db, set);
  }
  const before = getDiff(db, "p", "4");
  pruneHistory(db, "p", "4");
  assert.deepEqual(
    listChanges(db, "p").items.map((e) => e.id),
    ["4"],
  );
  assert.deepEqual(getDiff(db, "p", "4"), before);
  assert.deepEqual(
    db
      .prepare("SELECT revision FROM snapshots ORDER BY revision")
      .all()
      .map((r) => r.revision),
    [3, 4],
  );
  pruneHistory(db, "p", "999");
  assert.equal(db.prepare("SELECT content FROM snapshots").get().content, "4");
  assert.equal(commitChangeSet(db, set).events[0].id, "5");
});
test("symbol deletion diffs retain both source sides and their revisions after pruning", async (t) => {
  const { getDiff, pruneHistory } = await import("../dist/index.js");
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  const set = changeSet();
  commitChangeSet(db, set);
  set.changes[0] = {
    ...set.changes[0],
    action: "deleted",
    before: node,
    after: null,
  };
  set.sources.set("a.ts", "remaining code");
  commitChangeSet(db, set);
  pruneHistory(db, "p", "2");
  assert.deepEqual(getDiff(db, "p", "2"), {
    changeId: "2",
    path: "a.ts",
    beforeContent: "a",
    afterContent: "remaining code",
    beforeRevision: 1,
    afterRevision: 2,
  });
});

test("activity pages summarize actual file edits and recover older call endpoints", (t) => {
  const db = openDatabase({ databasePath: ":memory:" });
  t.after(() => db.close());
  const caller = {
    ...node,
    id: "caller",
    kind: "function",
    name: "saveOrder",
    qualifiedName: "saveOrder",
  };
  const callee = {
    ...caller,
    id: "callee",
    name: "authorizePayment",
    qualifiedName: "authorizePayment",
  };
  const callback = {
    ...caller,
    id: "callback",
    name: "$callback1",
    qualifiedName: "saveOrder.$callback1",
  };
  const changed = (before, after) => ({
    entityType: "node",
    entityId: (after ?? before).id,
    path: node.path,
    action:
      before === null ? "created" : after === null ? "deleted" : "modified",
    before,
    after,
  });
  const set = changeSet();
  set.graph.nodes.push(caller, callee, callback);
  set.changes.push(
    ...[caller, callee, callback].map((symbol) => changed(null, symbol)),
  );
  commitChangeSet(db, set);
  assert.equal(
    listChanges(db, "p", undefined, 3, { kind: "files" }).items.length,
    0,
  );

  const edited = { ...node, contentHash: "1".repeat(64) };
  const editedCaller = { ...caller, contentHash: "2".repeat(64) };
  const editedCallback = { ...callback, contentHash: "3".repeat(64) };
  const shiftedCallee = {
    ...callee,
    range: { ...callee.range, startLine: 2, endLine: 2 },
  };
  const edge = {
    id: "call",
    projectId: "p",
    sourceId: caller.id,
    targetId: callee.id,
    kind: "CALLS",
  };
  const added = {
    entityType: "edge",
    entityId: edge.id,
    path: node.path,
    action: "created",
    before: null,
    after: edge,
  };
  set.graph.nodes = [edited, editedCaller, shiftedCallee, editedCallback];
  set.graph.edges = [edge];
  set.sources.set(node.path, "edited source");
  set.changes = [
    changed(node, edited),
    changed(caller, editedCaller),
    changed(callee, shiftedCallee),
    changed(callback, editedCallback),
    added,
  ];
  const addedEvent = commitChangeSet(db, set).events.at(-1);
  const files = listChanges(db, "p", undefined, 3, { kind: "files" });
  assert.equal(files.items.length, 1);
  assert.equal(files.cursor, null);
  assert.deepEqual(files.items[0].fileSummary, {
    symbols: [{ name: "saveOrder", action: "modified" }],
    symbolCount: 1,
    addedCalls: 1,
    removedCalls: 0,
    addedImports: 0,
    removedImports: 0,
  });

  set.graph.nodes = [edited, editedCaller, editedCallback];
  set.graph.edges = [];
  set.changes = [
    changed(shiftedCallee, null),
    { ...added, action: "deleted", before: edge, after: null },
  ];
  const removedEvent = commitChangeSet(db, set).events.at(-1);
  // Before the relationship metadata migration, only the edge and node records were saved.
  db.exec("UPDATE change_events SET relationship = NULL");
  const relationships = listChanges(db, "p", undefined, 1, {
    kind: "relationships",
  });
  assert.equal(relationships.items[0].id, removedEvent.id);
  assert.equal(
    relationships.items[0].relationship.target.qualifiedName,
    "authorizePayment",
  );
  assert.equal(relationships.items[0].relationship.approximate, true);
  assert.equal(
    listChanges(db, "p", relationships.cursor, 1, { kind: "relationships" })
      .items[0].id,
    addedEvent.id,
  );
  assert.equal(
    getChange(db, "p", addedEvent.id).relationship.source.qualifiedName,
    "saveOrder",
  );
  assert.deepEqual(
    listChanges(db, "p", undefined, 2, { nodeId: callee.id }).items.map(
      ({ action }) => action,
    ),
    ["deleted", "modified"],
  );
});
