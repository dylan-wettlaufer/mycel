import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { createSourceChangeQueue } from "../dist/index.js";

const hash = (s) => createHash("sha256").update(s).digest("hex");
async function fixture(t, onBatch, debounceMs = 30) {
  const root = await mkdtemp(join(tmpdir(), "mycel-changes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "main.ts"), "original");
  const errors = [];
  const queue = createSourceChangeQueue({
    root,
    initialHashes: new Map([["main.ts", hash("original")]]),
    debounceMs,
    onBatch,
    onError: (e) => errors.push(e),
  });
  t.after(() => queue.close());
  const enqueue = (path = "main.ts") =>
    queue.enqueue({ kind: "change", path, observedAt: performance.now() });
  return { root, queue, errors, enqueue };
}

test("debounces bursts and skips identical content, including revert saves", async (t) => {
  const batches = [];
  const { root, queue, enqueue, errors } = await fixture(t, async (b) => {
    batches.push(b);
  });
  enqueue();
  await queue.flush();
  assert.equal(batches.length, 0);
  for (const source of ["one", "two", "final"]) {
    await writeFile(join(root, "main.ts"), source);
    enqueue();
  }
  await setTimeout(120);
  await queue.flush();
  assert.equal(batches.length, 1);
  assert.deepEqual([...batches[0].files], [["main.ts", "final"]]);
  assert.ok(batches[0].observedAt <= performance.now() - 30);
  await writeFile(join(root, "main.ts"), "temporary");
  enqueue();
  await writeFile(join(root, "main.ts"), "final");
  enqueue();
  await queue.flush();
  assert.equal(batches.length, 1);
  assert.deepEqual(errors, []);
});

test("reconciles ignore changes and retries failed batches without advancing hashes", async (t) => {
  let fail = true;
  const batches = [];
  const { root, queue, enqueue } = await fixture(t, async (b) => {
    if (fail) throw new Error("commit failed");
    batches.push(b);
  });
  await writeFile(join(root, "main.ts"), "changed");
  enqueue();
  await assert.rejects(queue.flush(), /commit failed/);
  fail = false;
  await queue.flush();
  assert.equal(batches.length, 1);
  await writeFile(join(root, ".gitignore"), "main.ts\n");
  enqueue(".gitignore");
  await queue.flush();
  assert.deepEqual([...batches[1].files], [["main.ts", null]]);
  await writeFile(join(root, ".gitignore"), "");
  enqueue(".gitignore");
  await queue.flush();
  assert.deepEqual([...batches[2].files], [["main.ts", "changed"]]);
});

test("serializes batches arriving during a commit and stops pending work on close", async (t) => {
  let release;
  let entered;
  const started = new Promise((r) => {
    entered = r;
  });
  const blocked = new Promise((r) => {
    release = r;
  });
  const batches = [];
  const { root, queue, enqueue } = await fixture(t, async (b) => {
    batches.push(b);
    if (batches.length === 1) {
      entered();
      await blocked;
    }
  });
  await writeFile(join(root, "main.ts"), "first");
  enqueue();
  const first = queue.flush();
  await started;
  await writeFile(join(root, "main.ts"), "second");
  enqueue();
  const second = queue.flush();
  assert.equal(batches.length, 1);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(
    batches.map((b) => b.files.get("main.ts")),
    ["first", "second"],
  );
  await writeFile(join(root, "main.ts"), "closed");
  enqueue();
  await queue.close();
  await queue.flush();
  assert.equal(batches.length, 2);
});
