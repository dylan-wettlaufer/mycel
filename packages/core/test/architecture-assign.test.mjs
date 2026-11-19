import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assignFilesToParts,
  buildFallbackArchitecture,
  discoverSourceFiles,
  findUnmatchedPatterns,
} from "../dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function makeArchitecture(parts, source = "agent") {
  return { version: 1, source, parts };
}

function part(id, paths, overrides = {}) {
  return {
    id,
    name: id,
    purpose: `Part ${id}.`,
    kind: "library",
    paths,
    ...overrides,
  };
}

test("assigns every indexed file in Mycel to its workspace fallback part", async () => {
  const discovered = await discoverSourceFiles(repoRoot);
  const fallback = await buildFallbackArchitecture(repoRoot);
  const result = assignFilesToParts(fallback, discovered.paths);

  assert.deepEqual(result.unassignedFiles, []);
  assert.deepEqual(result.tieWarnings, []);
  assert.equal(Object.keys(result.fileToPart).length, discovered.paths.length);

  const totalAssigned = result.parts.reduce(
    (sum, entry) => sum + entry.files.length,
    0,
  );
  assert.equal(totalAssigned, discovered.paths.length);

  const byId = new Map(result.parts.map((entry) => [entry.id, entry]));
  assert.deepEqual(
    [...byId.keys()],
    ["cli", "core", "db", "parser", "server", "shared", "web"],
  );
  for (const id of ["cli", "core", "db", "parser", "server", "shared", "web"]) {
    assert.ok(byId.get(id).files.length > 0, `expected files in ${id}`);
  }
  assert.equal(result.fileToPart["packages/core/src/index.ts"], "core");
  assert.equal(result.fileToPart["apps/web/src/App.tsx"], "web");
});

test("resolves overlapping patterns by leading literal segments, then pattern length", () => {
  const architecture = makeArchitecture([
    part("core", ["packages/core/**"]),
    part("core-tests", ["packages/core/test/**"]),
    part("entry", ["packages/core/src/index.ts"]),
    part("spec-files", ["packages/core/src/*.test.ts"]),
    part("core-src", ["packages/core/src/**"]),
    part("folder-shorthand", ["packages/db"]),
  ]);

  const files = [
    "packages/core/README.ts",
    "packages/core/src/index.ts",
    "packages/core/src/graph.ts",
    "packages/core/src/graph.test.ts",
    "packages/core/test/indexer.ts",
    "packages/db/src/client.ts",
  ];

  const result = assignFilesToParts(architecture, files);

  assert.deepEqual(result.unassignedFiles, []);
  assert.deepEqual(result.tieWarnings, []);
  assert.deepEqual(result.fileToPart, {
    "packages/core/README.ts": "core",
    "packages/core/src/graph.test.ts": "spec-files",
    "packages/core/src/graph.ts": "core-src",
    "packages/core/src/index.ts": "entry",
    "packages/core/test/indexer.ts": "core-tests",
    "packages/db/src/client.ts": "folder-shorthand",
  });
});

test("awards ties to the first listed part and emits tie warnings without false positives inside one part", () => {
  const architecture = makeArchitecture([
    part("first", ["packages/core/a*.ts", "packages/core/a?.ts"]),
    part("second", ["packages/core/*b.ts"]),
    part("third", ["packages/core/??.ts"]),
    part("broad", ["packages/core/**"]),
  ]);

  const result = assignFilesToParts(architecture, [
    "packages/core/ab.ts",
    "packages/core/aa.ts",
    "packages/core/zz.ts",
  ]);

  // "ab.ts": first ("a*.ts", 2/19), second ("*b.ts", 2/19), third ("??.ts", 2/19) all tie.
  assert.equal(result.fileToPart["packages/core/ab.ts"], "first");
  // "aa.ts": matches two patterns in `first` with equal specificity (2/19) and `third` ("??.ts", 2/19).
  assert.equal(result.fileToPart["packages/core/aa.ts"], "first");
  // "zz.ts": matches only `third` at (2/19), beating `broad` (2/16) cleanly.
  assert.equal(result.fileToPart["packages/core/zz.ts"], "third");

  assert.deepEqual(result.tieWarnings, [
    {
      path: "packages/core/aa.ts",
      winnerPartId: "first",
      tiedPartIds: ["first", "third"],
      patterns: ["packages/core/a*.ts", "packages/core/??.ts"],
    },
    {
      path: "packages/core/ab.ts",
      winnerPartId: "first",
      tiedPartIds: ["first", "second", "third"],
      patterns: [
        "packages/core/a*.ts",
        "packages/core/*b.ts",
        "packages/core/??.ts",
      ],
    },
  ]);

  // Multiple equal-specificity patterns on a SINGLE part do not emit a tie warning.
  const singlePart = makeArchitecture([
    part("solo", ["src/a*.ts", "src/*b.ts"]),
  ]);
  const soloResult = assignFilesToParts(singlePart, ["src/ab.ts"]);
  assert.equal(soloResult.fileToPart["src/ab.ts"], "solo");
  assert.deepEqual(soloResult.tieWarnings, []);
});

test("routes unmatched files to fallback parts, reports them, and disambiguates id collisions", () => {
  const architecture = makeArchitecture([
    part("core", ["packages/core/src/**"]),
    part("web", ["apps/web/**"]),
  ]);

  const fallback = makeArchitecture(
    [
      part("core", ["packages/core/**"], {
        purpose: "Workspace package at packages/core.",
      }),
      part("db", ["packages/db/**"], {
        kind: "data",
        purpose: "SQLite persistence and queries.",
      }),
      part("unused-pkg", ["packages/unused/**"]),
    ],
    "folder-fallback",
  );

  const result = assignFilesToParts(
    architecture,
    [
      "packages/core/src/index.ts",
      "packages/core/test/extra.ts",
      "packages/db/src/schema.ts",
      "scripts/release.ts",
      "vite.config.ts",
      "apps/web/src/App.tsx",
    ],
    { fallback },
  );

  assert.deepEqual(result.unassignedFiles, [
    "packages/core/test/extra.ts",
    "packages/db/src/schema.ts",
    "scripts/release.ts",
    "vite.config.ts",
  ]);
  assert.deepEqual(result.tieWarnings, []);

  // Declared parts come first in declaration order; only used fallback parts follow, sorted by id.
  assert.deepEqual(
    result.parts.map((entry) => [
      entry.id,
      Boolean(entry.fallback),
      entry.files,
    ]),
    [
      ["core", false, ["packages/core/src/index.ts"]],
      ["web", false, ["apps/web/src/App.tsx"]],
      ["core-fallback", true, ["packages/core/test/extra.ts"]],
      ["db", true, ["packages/db/src/schema.ts"]],
      ["root", true, ["vite.config.ts"]],
      ["scripts", true, ["scripts/release.ts"]],
    ],
  );

  assert.deepEqual(result.fileToPart, {
    "apps/web/src/App.tsx": "web",
    "packages/core/src/index.ts": "core",
    "packages/core/test/extra.ts": "core-fallback",
    "packages/db/src/schema.ts": "db",
    "scripts/release.ts": "scripts",
    "vite.config.ts": "root",
  });
});

test("handles deleted files and deduplicates repeated paths cleanly", () => {
  const architecture = makeArchitecture([
    part("alpha", ["src/a/**"]),
    part("beta", ["src/a/**"]),
    part("legacy", ["src/legacy/**"]),
  ]);

  const before = assignFilesToParts(architecture, [
    "src/a/one.ts",
    "src/a/one.ts",
    "src/legacy/old.ts",
    "orphan/temp.ts",
  ]);

  assert.equal(before.tieWarnings.length, 1);
  assert.deepEqual(before.unassignedFiles, ["orphan/temp.ts"]);
  assert.deepEqual(
    before.parts.map((entry) => [entry.id, entry.files]),
    [
      ["alpha", ["src/a/one.ts"]],
      ["beta", []],
      ["legacy", ["src/legacy/old.ts"]],
      ["orphan", ["orphan/temp.ts"]],
    ],
  );

  // After deleting all three files, re-running leaves no stale assignments, warnings, or fallback parts.
  const after = assignFilesToParts(architecture, ["src/a/two.ts"]);
  assert.deepEqual(after.fileToPart, { "src/a/two.ts": "alpha" });
  assert.deepEqual(after.unassignedFiles, []);
  assert.deepEqual(
    after.tieWarnings.map((warning) => warning.path),
    ["src/a/two.ts"],
  );
  assert.deepEqual(
    after.parts.map((entry) => [entry.id, entry.files]),
    [
      ["alpha", ["src/a/two.ts"]],
      ["beta", []],
      ["legacy", []],
    ],
  );
});

test("reports each pattern that matches no file, even when its part has other matches", () => {
  const architecture = makeArchitecture([
    part("app", ["src/app/**", "src/old-app/**", "src/main.ts"]),
    part("docs", ["docs"]),
  ]);

  assert.deepEqual(
    findUnmatchedPatterns(architecture, ["src/app/page.ts", "src/main.ts"]),
    [
      { partId: "app", pattern: "src/old-app/**" },
      { partId: "docs", pattern: "docs" },
    ],
  );
  assert.deepEqual(
    findUnmatchedPatterns(architecture, [
      "src/app/page.ts",
      "src/old-app/page.ts",
      "src/main.ts",
      "docs/guide.ts",
    ]),
    [],
  );
});
