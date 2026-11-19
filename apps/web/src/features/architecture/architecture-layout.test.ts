import { describe, expect, test } from "vitest";
import type { ArchitectureMap } from "@mycel/shared";
import { layoutArchitectureMap, partNodeSize } from "./architecture-layout";

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

describe("layoutArchitectureMap", () => {
  test("creates part cards with metadata, change classes, and orthogonal routed edges", () => {
    const { nodes, edges } = layoutArchitectureMap(sampleMap);

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

    expect(edges).toHaveLength(3);
    const coreToDb = edges.find((edge) => edge.id === "core->db")!;
    const dbToCore = edges.find((edge) => edge.id === "db->core")!;
    const webToCore = edges.find((edge) => edge.id === "web->core")!;

    expect(coreToDb.type).toBe("behaviour");
    expect(coreToDb.label).toBe("3 links");
    expect(coreToDb.style?.stroke).toBe("var(--success)");
    expect(webToCore.label).toBe("2 imports");
    expect(webToCore.style?.stroke).toBe("var(--warning)");

    // Opposite edge routes underneath cards instead of colliding with forward edge.
    const forwardRoute = coreToDb.data?.route as { label: { y: number } };
    const backwardRoute = dbToCore.data?.route as { label: { y: number } };
    expect(backwardRoute.label.y).toBeGreaterThan(forwardRoute.label.y);
  });

  test("routes long-skip edges around intermediate cards without intersecting them and fans out handles", () => {
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
    const mkConn = (sourcePartId: string, targetPartId: string) => ({
      id: `${sourcePartId}->${targetPartId}`,
      sourcePartId,
      targetPartId,
      count: 2,
      importCount: 2,
      callCount: 0,
      truncated: false,
      evidence: [],
      change: { status: "unchanged" as const, uncommitted: false },
    });

    const multiColumnMap: ArchitectureMap = {
      ...sampleMap,
      parts: ["cli", "server", "core", "db", "parser", "web", "shared"].map(
        mkPart,
      ),
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

    const { nodes, edges } = layoutArchitectureMap(multiColumnMap);
    const shared = nodes.find((node) => node.id === "shared")!;
    const sharedTargetHandles = (shared.data.handles ?? []).filter(
      (handle) => handle.type === "target",
    );
    expect(sharedTargetHandles.length).toBeGreaterThan(1);

    // Every routed edge segment must stay clear of every unrelated part card.
    const boxes = nodes.map((node) => ({
      id: node.id,
      left: node.position.x,
      right: node.position.x + partNodeSize.width,
      top: node.position.y,
      bottom: node.position.y + partNodeSize.height,
    }));
    for (const edge of edges) {
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
