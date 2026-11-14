import assert from "node:assert/strict";
import test from "node:test";
import {
  openDatabase,
  commitChangeSet,
  currentRevision,
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
