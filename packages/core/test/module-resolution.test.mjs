import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { openDatabase } from "@mycel/db";
import { parseFile } from "@mycel/parser";
import { indexRepository, watchRepository } from "../dist/index.js";
async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), "mycel-resolution-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (path, content) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(
      join(root, path),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  };
  for (const [path, content] of Object.entries(files))
    await write(path, content);
  const database = openDatabase({ databasePath: ":memory:" });
  t.after(() => database.close());
  const edges = (kind) =>
    database
      .prepare(
        "SELECT source.path AS source, target.path AS target FROM edges e JOIN nodes source ON source.id = e.source_id AND source.project_id = e.project_id JOIN nodes target ON target.id = e.target_id AND target.project_id = e.project_id WHERE e.kind = ? ORDER BY source.path, target.path",
      )
      .all(kind)
      .map((edge) => `${edge.source} -> ${edge.target}`);
  return { root, write, database, edges, project: { name: "fixture", root } };
}
async function until(check) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() >= deadline)
      assert.fail("Timed out waiting for module resolution");
    await setTimeout(25);
  }
}

test("resolves inherited aliases, solution configs, baseUrl and workspace exports to source before a build", async (t) => {
  const { database, project, edges } = await fixture(t, {
    "package.json": { name: "fixture", workspaces: ["packages/*", "apps/*"] },
    "tsconfig.json": { extends: "./configs/base.json", files: ["root.ts"] },
    "configs/base.json":
      '{ // JSONC and inherited paths are relative to this config\n "compilerOptions": {"baseUrl": "..", "paths": {"@shared/*": ["absent/*", "packages/lib/src/*"]}}\n}',
    "root.ts": 'import {save} from "@shared/features/save"; save();',
    "apps/web/tsconfig.json": {
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    },
    "apps/web/tsconfig.app.json": {
      extends: "../../tsconfig.json",
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
          "@special/*": ["absent/*", "src/*"],
          "@outside": ["../../../outside.ts"],
        },
      },
      include: ["src"],
    },
    "apps/web/src/main.ts":
      'import {save} from "@demo/lib"; import {save as feature} from "@demo/lib/feature/save"; import {helper} from "@/helper"; import {helper as fallback} from "@special/helper"; import {base} from "local"; import "@demo/lib/blocked"; import "@outside"; import "react"; import {explicit} from "@demo/explicit"; export function start() {save(); feature(); helper(); fallback(); base(); explicit();}',
    "apps/web/src/helper.ts": "export function helper() {}",
    "apps/web/local.ts": "export function base() {}",
    "packages/lib/package.json": {
      name: "@demo/lib",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./feature/*": {
          types: "./dist/features/*.d.ts",
          import: "./dist/features/*.js",
        },
        "./blocked": null,
      },
    },
    "packages/lib/tsconfig.json": {
      extends: "../../tsconfig.json",
      compilerOptions: { rootDir: "src", outDir: "dist" },
      include: ["src"],
    },
    "packages/lib/src/index.ts": 'export {save} from "./features/save.js";',
    "packages/lib/src/features/save.ts": "export function save() {}",
    "packages/explicit/package.json": {
      name: "@demo/explicit",
      source: "src/start.ts",
      main: "dist/start.js",
    },
    "packages/explicit/src/start.ts": "export function explicit() {}",
    "packages/lib/blocked.ts": "export function hidden() {}",
  });
  await indexRepository({ database, project });
  assert.deepEqual(edges("IMPORTS"), [
    "apps/web/src/main.ts -> apps/web/local.ts",
    "apps/web/src/main.ts -> apps/web/src/helper.ts",
    "apps/web/src/main.ts -> packages/explicit/src/start.ts",
    "apps/web/src/main.ts -> packages/lib/src/features/save.ts",
    "apps/web/src/main.ts -> packages/lib/src/index.ts",
    "packages/lib/src/index.ts -> packages/lib/src/features/save.ts",
    "root.ts -> packages/lib/src/features/save.ts",
  ]);
  assert.deepEqual(edges("CALLS"), [
    "apps/web/src/main.ts -> apps/web/local.ts",
    "apps/web/src/main.ts -> apps/web/src/helper.ts",
    "apps/web/src/main.ts -> packages/explicit/src/start.ts",
    "apps/web/src/main.ts -> packages/lib/src/features/save.ts",
    "root.ts -> packages/lib/src/features/save.ts",
  ]);
  const diagnostics = database
    .prepare("SELECT code, message FROM diagnostics ORDER BY message")
    .all();
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((item) => item.code === "unresolved-module"));
  assert.ok(
    diagnostics.some((item) => item.message.includes("@demo/lib/blocked")),
  );
  assert.ok(diagnostics.some((item) => item.message.includes("@outside")));
});

test("config, manifest and pnpm workspace edits rewire unchanged consumers without reparsing", async (t) => {
  const setup = await fixture(t, {
    "package.json": { name: "fixture" },
    "pnpm-workspace.yaml": 'packages:\n  - "libs/*"\n',
    "tsconfig.json": { compilerOptions: { paths: { "@alias": ["./a.ts"] } } },
    "main.ts":
      'import {choose} from "@alias"; import {work} from "@demo/lib"; export function call() {choose(); work();}',
    "a.ts": "export function choose() {}",
    "b.ts": "export function choose() {}",
    "libs/lib/package.json": {
      name: "@demo/lib",
      exports: { ".": "./src/a.ts" },
    },
    "libs/lib/src/a.ts": "export function work() {}",
    "libs/lib/src/b.ts": "export function work() {}",
  });
  const parsed = [],
    errors = [];
  const live = await watchRepository({
    ...setup,
    debounceMs: 20,
    parse: (path, source) => {
      parsed.push(path);
      return parseFile(path, source);
    },
    onError: (error) => errors.push(error),
  });
  t.after(() => live.close());
  assert.deepEqual(setup.edges("CALLS"), [
    "main.ts -> a.ts",
    "main.ts -> libs/lib/src/a.ts",
  ]);
  parsed.length = 0;
  await setup.write("tsconfig.json", {
    compilerOptions: { paths: { "@alias": ["./b.ts"] } },
  });
  await until(() => setup.edges("CALLS").includes("main.ts -> b.ts"));
  await setup.write("libs/lib/package.json", {
    name: "@demo/lib",
    exports: { ".": "./src/b.ts" },
  });
  await until(() =>
    setup.edges("CALLS").includes("main.ts -> libs/lib/src/b.ts"),
  );
  await setup.write("pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n');
  await until(() => setup.edges("CALLS").length === 1);
  await setup.write("pnpm-workspace.yaml", 'packages:\n  - "libs/*"\n');
  await until(() => setup.edges("CALLS").length === 2);
  await setup.write("tsconfig.json", "{ invalid");
  await until(() =>
    Boolean(
      setup.database
        .prepare("SELECT id FROM diagnostics WHERE code = 'resolution-config'")
        .get(),
    ),
  );
  await setup.write("tsconfig.json", {
    compilerOptions: { paths: { "@alias": ["./b.ts"] } },
  });
  await until(() => setup.edges("CALLS").includes("main.ts -> b.ts"));
  assert.deepEqual(parsed, []);
  assert.deepEqual(errors, []);
});
