import { describe, expect, test } from "vitest";
import type { ArchitectureMap } from "@mycel/shared";
import {
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

const mkPart = (
  id: string,
  kind: ArchitectureMap["parts"][number]["kind"] = "library",
) => ({
  id,
  name: id,
  purpose: `${id} part.`,
  kind,
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
  parts: [
    mkPart("cli", "cli"),
    mkPart("server", "service"),
    mkPart("core"),
    mkPart("db", "data"),
    mkPart("parser"),
    mkPart("web", "app"),
    mkPart("shared"),
  ],
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
    expect(web.position.y).toBeLessThan(core.position.y);
    expect(core.position.y).toBeLessThan(db.position.y);
    expect(core.className).toContain("arch-part-changed");
    expect(core.className).toContain("arch-part-uncommitted");
    expect(db.className).toContain("arch-part-new");
    expect(db.className).toContain("arch-part-uncommitted");
    expect(web.className).not.toContain("arch-part-new");
    expect(web.className).not.toContain("arch-part-changed");

    // web->core (2) and db->core (1) are minor; core->db (3) stays.
    expect(hiddenMinorCount).toBe(2);
    expect(edges.map((edge) => edge.id)).toEqual(["core->db"]);
    expect(edges[0]!.data?.bidirectional).toBe(false);
  });

  test("merges opposite connections and keeps their counts and change details", () => {
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
    expect(coreDb.label).toBe("1 import · 2 calls → · 1 import ←");
    expect(coreDb.data?.connectionIds).toEqual(["core->db", "db->core"]);
    expect(coreDb.data?.bidirectional).toBe(true);
    expect(coreDb.data?.changeStatus).toBe("new");
    expect(coreDb.data?.uncommitted).toBe(true);
    expect(webToCore.label).toBe("2 imports");
    expect(webToCore.data?.changeStatus).toBe("changed");
  });

  test("places foundational dependencies alongside data", () => {
    expect([...findFoundationParts(multiColumnMap)]).toEqual(["shared"]);
    // A widely used part that depends on another part is not a foundation.
    expect(
      findFoundationParts({
        ...multiColumnMap,
        connections: [...multiColumnMap.connections, mkConn("shared", "db")],
      }).size,
    ).toBe(0);
    expect(findFoundationParts(sampleMap).size).toBe(0);
    expect(
      findFoundationParts({
        ...multiColumnMap,
        parts: multiColumnMap.parts.map((part) =>
          part.id === "shared" ? { ...part, kind: "app" } : part,
        ),
      }).size,
    ).toBe(0);

    const { nodes, edges } = layoutArchitectureMap(multiColumnMap);
    const shared = nodes.find((node) => node.id === "shared")!;
    expect(shared.data.usedBy).toBe(6);
    expect(shared.className).toContain("arch-part-foundation");
    for (const node of nodes) {
      if (node.id === "shared") continue;
      expect(node.data.usedBy).toBeUndefined();
      if (node.id === "db") expect(shared.position.y).toBe(node.position.y);
      else
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

  test("anchors direct curves vertically and detours through gaps on skipped rows", () => {
    const { nodes, edges } = layoutArchitectureMap({
      ...multiColumnMap,
      connections: [
        ...multiColumnMap.connections,
        mkConn("cli", "db"),
        mkConn("db", "cli", 1),
      ],
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const direct = edges.find((edge) => edge.id === "cli->server")!;
    expect(direct.data?.curved).toBe(true);
    expect(direct.data?.curve).toBeUndefined();
    expect(byId.get("cli")?.data.handles).toContainEqual(
      expect.objectContaining({ id: direct.sourceHandle, position: "bottom" }),
    );
    expect(byId.get("server")?.data.handles).toContainEqual(
      expect.objectContaining({ id: direct.targetHandle, position: "top" }),
    );

    const skip = edges.find((edge) => edge.id === "cli->db")!;
    const curve = skip.data?.curve as { waypoints: { x: number; y: number }[] };
    expect(curve.waypoints).toHaveLength(4);
    for (const [index, id] of ["server", "core"].entries()) {
      const position = byId.get(id)!.position;
      const [entry, exit] = curve.waypoints.slice(index * 2, index * 2 + 2);
      expect(entry!.x).toBe(exit!.x);
      expect(entry!.y).toBeLessThan(position.y);
      expect(exit!.y).toBeGreaterThan(position.y + partNodeSize.height);
      for (const node of nodes.filter(
        (item) => item.position.y === position.y,
      )) {
        expect(
          entry!.x < node.position.x ||
            entry!.x > node.position.x + partNodeSize.width,
        ).toBe(true);
      }
    }
  });
});
