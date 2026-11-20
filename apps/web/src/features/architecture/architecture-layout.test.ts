import { describe, expect, test } from "vitest";
import type { ArchitectureMap } from "@mycel/shared";
import {
  connectionWeight,
  findFoundationParts,
  layoutArchitectureMap,
  partNodeSize,
} from "./architecture-layout";

const sampleMap: ArchitectureMap = {
  projectId: "project:demo",
  revision: 3,
  source: "folder-fallback",
  parts: [
    {
      id: "web",
      name: "web",
      purpose: "Browser dashboard.",
      kind: "app",
      paths: ["apps/web/**"],
      files: ["apps/web/src/App.tsx"],
      change: {
        status: "unchanged",
        uncommitted: false,
        addedFiles: 0,
        modifiedFiles: 0,
        uncommittedFiles: 0,
      },
    },
    {
      id: "core",
      name: "core",
      purpose: "Indexing and graph engine.",
      kind: "library",
      paths: ["packages/core/**"],
      files: ["packages/core/src/index.ts", "packages/core/src/graph.ts"],
      change: {
        status: "changed",
        uncommitted: true,
        addedFiles: 0,
        modifiedFiles: 1,
        uncommittedFiles: 1,
      },
    },
    {
      id: "db",
      name: "db",
      purpose: "SQLite persistence.",
      kind: "data",
      paths: ["packages/db/**"],
      files: ["packages/db/src/index.ts"],
      change: {
        status: "new",
        uncommitted: true,
        addedFiles: 1,
        modifiedFiles: 0,
        uncommittedFiles: 1,
      },
    },
  ],
  connections: [
    {
      id: "web->core",
      sourcePartId: "web",
      targetPartId: "core",
      count: 2,
      importCount: 2,
      callCount: 0,
      truncated: false,
      evidence: [
        {
          kind: "import",
          file: "apps/web/src/App.tsx",
          line: 1,
          targetFile: "packages/core/src/index.ts",
        },
      ],
      change: { status: "changed", uncommitted: true },
    },
    {
      id: "core->db",
      sourcePartId: "core",
      targetPartId: "db",
      count: 3,
      importCount: 1,
      callCount: 2,
      truncated: false,
      evidence: [
        {
          kind: "call",
          file: "packages/core/src/index.ts",
          line: 10,
          targetFile: "packages/db/src/index.ts",
          sourceSymbol: "init",
          symbol: "openDatabase",
        },
      ],
      change: { status: "new", uncommitted: true },
    },
    {
      id: "db->core",
      sourcePartId: "db",
      targetPartId: "core",
      count: 1,
      importCount: 1,
      callCount: 0,
      truncated: false,
      evidence: [
        {
          kind: "import",
          file: "packages/db/src/index.ts",
          line: 1,
          targetFile: "packages/core/src/index.ts",
        },
      ],
      change: { status: "new", uncommitted: false },
    },
  ],
  changes: {
    available: true,
    requestedWindow: "branch",
    resolvedWindow: "branch",
    branch: "feat/db",
    baseRef: "main",
    baseCommit: "abc123",
    addedFiles: ["packages/db/src/index.ts"],
    modifiedFiles: ["packages/core/src/index.ts"],
    deletedFiles: [],
    uncommittedFiles: [
      "packages/core/src/index.ts",
      "packages/db/src/index.ts",
    ],
  },
  unassignedFiles: [],
  tieWarnings: [],
};

const mkPart = (id: string) => ({
  id,
  name: id,
  purpose: `${id} part.`,
  kind: "library" as const,
  paths: [`packages/${id}/**`],
  files: [`packages/${id}/index.ts`],
  change: {
    status: "unchanged" as const,
    uncommitted: false,
    addedFiles: 0,
    modifiedFiles: 0,
    uncommittedFiles: 0,
  },
});
const mkConn = (sourcePartId: string, targetPartId: string, count = 3) => ({
  id: `${sourcePartId}->${targetPartId}`,
  sourcePartId,
  targetPartId,
  count,
  importCount: count,
  callCount: 0,
  truncated: false,
  evidence: [],
  change: { status: "unchanged" as const, uncommitted: false },
});

const multiColumnMap: ArchitectureMap = {
  ...sampleMap,
  parts: ["cli", "server", "core", "db", "parser", "web", "shared"].map(mkPart),
  connections: [
    mkConn("cli", "server"),
    mkConn("cli", "shared"),
    mkConn("server", "core"),
    mkConn("server", "shared"),
    mkConn("core", "db"),
    mkConn("core", "parser"),
    mkConn("core", "shared"),
    mkConn("db", "shared"),
    mkConn("parser", "shared"),
    mkConn("web", "shared"),
  ],
};

describe("layoutArchitectureMap", () => {
  test("creates part cards with metadata and change classes, hiding minor connections by default", () => {
    const { nodes, edges, hiddenMinorCount } = layoutArchitectureMap(sampleMap);

    expect(nodes.map((node) => node.id)).toEqual(["web", "core", "db"]);
    const core = nodes.find((node) => node.id === "core")!;
    const db = nodes.find((node) => node.id === "db")!;
    const web = nodes.find((node) => node.id === "web")!;

    expect(core.type).toBe("part");
    expect(core.data.fileCount).toBe(2);
    expect(web.position.x).toBeLessThan(core.position.x);
    expect(core.position.x).toBeLessThan(db.position.x);
    expect(core.className).toContain("arch-part-changed");
    expect(core.className).toContain("arch-part-uncommitted");
    expect(db.className).toContain("arch-part-new");
    expect(db.className).toContain("arch-part-uncommitted");
    expect(web.className).not.toContain("arch-part-new");
    expect(web.className).not.toContain("arch-part-changed");

    // web->core (2) and db->core (1) are minor; core->db (3) stays.
    expect(hiddenMinorCount).toBe(2);
    expect(edges.map((edge) => edge.id)).toEqual(["core->db"]);
    expect(edges[0]!.markerStart).toBeUndefined();
  });

  test("merges opposite connections into one two-headed line and scales width with link count", () => {
    const { nodes, edges, hiddenMinorCount } = layoutArchitectureMap(
      sampleMap,
      { showMinor: true },
    );
    const positionsWithoutMinor = layoutArchitectureMap(sampleMap).nodes.map(
      (node) => node.position,
    );
    expect(nodes.map((node) => node.position)).toEqual(positionsWithoutMinor);

    expect(hiddenMinorCount).toBe(0);
    expect(edges.map((edge) => edge.id).sort()).toEqual([
      "core->db",
      "web->core",
    ]);
    const coreDb = edges.find((edge) => edge.id === "core->db")!;
    const webToCore = edges.find((edge) => edge.id === "web->core")!;

    expect(coreDb.type).toBe("behaviour");
    expect(coreDb.label).toBe("3 links → · 1 import ←");
    expect(coreDb.markerStart).toBeDefined();
    expect(coreDb.data?.connectionIds).toEqual(["core->db", "db->core"]);
    expect(coreDb.data?.bidirectional).toBe(true);
    expect(coreDb.style?.stroke).toBe("var(--success)");
    expect(coreDb.data?.uncommitted).toBe(true);
    expect(webToCore.label).toBe("2 imports");
    expect(webToCore.style?.stroke).toBe("var(--warning)");
    expect(Number(coreDb.style?.strokeWidth)).toBeGreaterThan(
      Number(webToCore.style?.strokeWidth),
    );
  });

  test("weights grow with link count and stay within bounds", () => {
    expect(connectionWeight(1)).toBe(1.25);
    expect(connectionWeight(2)).toBe(2.5);
    expect(connectionWeight(8)).toBe(5);
    expect(connectionWeight(1000)).toBe(6);
  });

  test("pins parts that most others use and that depend on nothing below the map", () => {
    expect([...findFoundationParts(multiColumnMap)]).toEqual(["shared"]);
    // A widely used part that depends on another part is not a foundation.
    expect(
      findFoundationParts({
        ...multiColumnMap,
        connections: [...multiColumnMap.connections, mkConn("shared", "db")],
      }).size,
    ).toBe(0);
    expect(findFoundationParts(sampleMap).size).toBe(0);

    const { nodes, edges } = layoutArchitectureMap(multiColumnMap);
    const shared = nodes.find((node) => node.id === "shared")!;
    expect(shared.data.usedBy).toBe(6);
    expect(shared.className).toContain("arch-part-foundation");
    for (const node of nodes) {
      if (node.id === "shared") continue;
      expect(node.data.usedBy).toBeUndefined();
      expect(shared.position.y).toBeGreaterThan(
        node.position.y + partNodeSize.height,
      );
    }

    const foundationEdges = edges.filter((edge) => edge.data?.foundation);
    expect(foundationEdges.map((edge) => edge.source).sort()).toEqual([
      "cli",
      "core",
      "db",
      "parser",
      "server",
      "web",
    ]);
    expect(foundationEdges.every((edge) => edge.target === "shared")).toBe(
      true,
    );
    const sharedTargetHandles = (shared.data.handles ?? []).filter(
      (handle) => handle.type === "target",
    );
    expect(sharedTargetHandles).toHaveLength(6);
  });

  test("routes long-skip edges around intermediate cards without intersecting them", () => {
    const { nodes, edges } = layoutArchitectureMap({
      ...multiColumnMap,
      connections: [
        ...multiColumnMap.connections,
        mkConn("cli", "db"),
        mkConn("web", "core"),
      ],
    });
    const boxes = nodes.map((node) => ({
      id: node.id,
      left: node.position.x,
      right: node.position.x + partNodeSize.width,
      top: node.position.y,
      bottom: node.position.y + partNodeSize.height,
    }));
    const routed = edges.filter((edge) => !edge.data?.foundation);
    expect(routed.length).toBeGreaterThanOrEqual(6);
    for (const edge of routed) {
      const route = edge.data?.route as {
        source: { x: number; y: number };
        target: { x: number; y: number };
        bends: { x: number; y: number }[];
      };
      const pts = [route.source, ...route.bends, route.target];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        for (const box of boxes) {
          if (box.id === edge.source || box.id === edge.target) continue;
          const intersects =
            Math.max(a.x, b.x) > box.left &&
            Math.min(a.x, b.x) < box.right &&
            Math.max(a.y, b.y) > box.top &&
            Math.min(a.y, b.y) < box.bottom;
          expect(intersects, `${edge.id} crossed ${box.id}`).toBe(false);
        }
      }
    }
  });
});
