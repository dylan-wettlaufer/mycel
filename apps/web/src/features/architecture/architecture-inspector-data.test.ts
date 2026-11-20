import { expect, test } from "vitest";
import type {
  ArchitectureConnectionWithChanges,
  ArchitectureGitChanges,
} from "@mycel/shared";
import {
  groupConnectionEvidence,
  groupPartConnections,
  groupPartFiles,
  entryPointsForPart,
} from "./architecture-inspector-data";

function connection(
  sourcePartId: string,
  targetPartId: string,
  files: string[],
): ArchitectureConnectionWithChanges {
  return {
    id: `${sourcePartId}->${targetPartId}`,
    sourcePartId,
    targetPartId,
    count: files.length,
    importCount: files.length,
    callCount: 0,
    truncated: false,
    change: { status: "unchanged", uncommitted: false },
    evidence: files.map((targetFile, index) => ({
      kind: "import",
      file: `${sourcePartId}/${index % 2}.ts`,
      line: index + 1,
      targetFile,
    })),
  };
}

test("groups reciprocal relationships once, ranks each group and scales against the whole map", () => {
  const apiUsesDb = connection("api", "db", Array(3).fill("db.ts"));
  const dbUsesApi = connection("db", "api", ["api.ts"]);
  const grouped = groupPartConnections("api", [
    apiUsesDb,
    connection("api", "small", ["small.ts"]),
    dbUsesApi,
    connection("api", "large", Array(5).fill("large.ts")),
    connection("cli", "api", ["api.ts"]),
    connection("jobs", "queue", Array(6).fill("queue.ts")),
    connection("queue", "jobs", Array(4).fill("jobs.ts")),
  ]);
  expect(grouped.twoWay).toEqual([
    { partId: "db", uses: apiUsesDb, usedBy: dbUsesApi, count: 4 },
  ]);
  expect(grouped.uses.map(({ partId }) => partId)).toEqual(["large", "small"]);
  expect(grouped.usedBy.map(({ partId }) => partId)).toEqual(["cli"]);
  expect(grouped.strongest).toBe(10);
});

test("ranks entry points and associates deduplicated call symbols with their callers", () => {
  const apiUsesDb = connection("api", "db", [
    "store.ts",
    "store.ts",
    "migration.ts",
  ]);
  apiUsesDb.evidence = apiUsesDb.evidence.map((item) =>
    item.targetFile === "store.ts"
      ? { ...item, kind: "call", symbol: "startServer" }
      : item,
  );
  expect(
    entryPointsForPart({ id: "db", files: ["store.ts", "migration.ts"] }, [
      apiUsesDb,
      connection("jobs", "db", ["store.ts"]),
      connection("db", "cache", ["ignored.ts"]),
    ]),
  ).toEqual([
    {
      path: "store.ts",
      links: 3,
      callers: [
        { partId: "api", symbols: ["startServer"] },
        { partId: "jobs", symbols: [] },
      ],
    },
    {
      path: "migration.ts",
      links: 1,
      callers: [{ partId: "api", symbols: [] }],
    },
  ]);
});

test("omits single-link entry points for small parts only", () => {
  const links = [connection("api", "db", ["store.ts", "migration.ts"])];
  const files = [
    "store.ts",
    "migration.ts",
    "index.ts",
    "schema.ts",
    "seed.ts",
    "query.ts",
    "client.ts",
    "types.ts",
  ];
  expect(entryPointsForPart({ id: "db", files }, links)).toEqual([]);
  expect(
    entryPointsForPart({ id: "db", files: [...files, "config.ts"] }, links),
  ).toHaveLength(2);
});

test("puts changed folders and files first and preserves both file status and uncommitted state", () => {
  const changes: ArchitectureGitChanges = {
    available: true,
    requestedWindow: "7d",
    resolvedWindow: "7d",
    branch: "main",
    baseRef: null,
    baseCommit: null,
    addedFiles: ["z/c.ts"],
    modifiedFiles: ["z/b.ts"],
    deletedFiles: [],
    uncommittedFiles: ["z/c.ts"],
  };
  const groups = groupPartFiles(
    ["a.ts", "z/a.ts", "z/b.ts", "z/c.ts"],
    changes,
  );
  expect(groups.map(({ folder }) => folder)).toEqual(["z", ""]);
  expect(
    groups[0]?.files.map(({ name, status, uncommitted }) => [
      name,
      status,
      uncommitted,
    ]),
  ).toEqual([
    ["b.ts", "edited", false],
    ["c.ts", "new", true],
    ["a.ts", null, false],
  ]);
});

test("groups connection evidence by source file and keeps each original location", () => {
  const { evidence } = connection("api", "db", ["db.ts", "db.ts", "schema.ts"]);
  expect(groupConnectionEvidence(evidence)).toEqual([
    ["api/0.ts", [evidence[0], evidence[2]]],
    ["api/1.ts", [evidence[1]]],
  ]);
});
