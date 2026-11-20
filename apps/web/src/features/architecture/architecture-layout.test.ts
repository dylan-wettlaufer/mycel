import { describe, expect, test } from "vitest";
import type { ArchitectureMap } from "@mycel/shared";
import {
  findFoundationParts,
  layoutArchitectureMap,
} from "./architecture-layout";
import {
  partNodeSize,
  placeArchitectureColumns,
  routeArchitectureLinks,
  type ArchitectureCurve,
} from "./architecture-routing";

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
      if (node.id === "db") expect(shared.position.x).toBe(node.position.x);
      else
        expect(shared.position.x).toBeGreaterThan(
          node.position.x + partNodeSize.width,
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

  test("orders related cards to straighten links between role columns", () => {
    const { nodes, edges } = layoutArchitectureMap({
      ...sampleMap,
      parts: [
        mkPart("web", "app"),
        mkPart("cli", "cli"),
        mkPart("api", "service"),
        mkPart("daemon", "service"),
      ],
      connections: [mkConn("web", "daemon"), mkConn("cli", "api")],
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const edge of edges) {
      const source = byId.get(edge.source)!;
      const target = byId.get(edge.target)!;
      expect(source.position.y).toBe(target.position.y);
      expect(source.data.handles).toContainEqual(
        expect.objectContaining({ id: edge.sourceHandle, position: "right" }),
      );
      expect(target.data.handles).toContainEqual(
        expect.objectContaining({ id: edge.targetHandle, position: "left" }),
      );
      expect(edge.data?.curve).toBeUndefined();
    }
  });

  test("gives links through the same card column separate tracks clear of cards", () => {
    const { nodes, edges } = layoutArchitectureMap({
      ...sampleMap,
      parts: [
        mkPart("cli", "cli"),
        mkPart("server", "service"),
        mkPart("one", "library"),
        mkPart("two", "library"),
        mkPart("db", "data"),
      ],
      connections: [
        mkConn("cli", "db"),
        mkConn("one", "cli"),
        mkConn("cli", "two"),
      ],
    });
    const server = nodes.find((node) => node.id === "server")!;
    const tracks = edges.map((edge) => {
      const curve = edge.data?.curve as ArchitectureCurve;
      const [a, b] = curve.waypoints;
      expect(a!.y).toBe(b!.y);
      expect(Math.min(a!.x, b!.x)).toBeLessThan(server.position.x);
      expect(Math.max(a!.x, b!.x)).toBeGreaterThan(
        server.position.x + partNodeSize.width,
      );
      expect(
        a!.y < server.position.y ||
          a!.y > server.position.y + partNodeSize.height,
      ).toBe(true);
      return a!.y;
    });
    expect(new Set(tracks).size).toBe(edges.length);
  });

  test("picks the clear side of a column that also avoids crossing a direct link", () => {
    const columns = [["launcher", "web"], ["api"], ["indexer", "architecture"]];
    const positions = placeArchitectureColumns(columns, []);
    const { routes } = routeArchitectureLinks(columns, positions, [
      mkConn("api", "indexer"),
      mkConn("launcher", "architecture"),
    ]);

    const track = routes[1]!.curve!.waypoints[0]!;
    expect(track.y).toBeGreaterThan(
      positions.get("api")!.y + partNodeSize.height,
    );
  });

  test("takes a side route past intervening cards in the same column", () => {
    const ids = ["a", "b", "c", "d"];
    const { nodes, edges } = layoutArchitectureMap({
      ...sampleMap,
      parts: ids.map((id) => mkPart(id)),
      connections: [
        mkConn("a", "b"),
        mkConn("b", "c"),
        mkConn("c", "d"),
        mkConn("a", "d"),
      ],
    });
    const edge = edges.find((item) => item.id === "a->d")!;
    const card = nodes.find((node) => node.id === "b")!;
    const curve = edge.data?.curve as ArchitectureCurve;
    expect(curve.waypoints).toHaveLength(2);
    expect(curve.waypoints[0]!.x).toBe(curve.waypoints[1]!.x);
    const lane = curve.waypoints[0]!.x;
    expect(
      lane < card.position.x || lane > card.position.x + partNodeSize.width,
    ).toBe(true);
  });
});
