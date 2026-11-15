import { expect, test } from "vitest";
import type { GraphNode, RepositoryGraph } from "@mycel/shared";
import {
  fileScope,
  groupRepository,
  layoutRepositoryGroups,
} from "./repository-layout";
function file(id: string, path: string) {
  return { id, path, kind: "file" } as GraphNode;
}
const graph: RepositoryGraph = {
  projectId: "p",
  revision: 1,
  files: [
    file("a", "apps/web/a.ts"),
    file("b", "packages/core/b.ts"),
    file("c", "apps/web/c.ts"),
    file("d", "isolated.ts"),
  ],
  dependencies: [
    { id: "ab", sourceId: "a", targetId: "b", kind: "IMPORTS" },
    { id: "cb", sourceId: "c", targetId: "b", kind: "IMPORTS" },
    { id: "ac", sourceId: "a", targetId: "c", kind: "IMPORTS" },
  ].map((edge) => ({ ...edge, kind: "IMPORTS", projectId: "p", revision: 1 })),
};
test("repository groups preserve isolated files and aggregate directed cross-folder imports", () => {
  const result = groupRepository(graph, 2);
  expect([...result.groups.keys()]).toEqual([
    "apps/web",
    "packages/core",
    "(root)",
  ]);
  expect(result.connections).toEqual([
    { source: "apps/web", target: "packages/core", count: 2 },
  ]);
  const layout = layoutRepositoryGroups(graph, 2, "apps/web");
  expect(layout.nodes).toHaveLength(3);
  expect(
    layout.nodes.every(
      (node) =>
        Number.isFinite(node.position.x) && Number.isFinite(node.position.y),
    ),
  ).toBe(true);
  expect(layout.nodes.find((node) => node.id === "apps/web")?.selected).toBe(
    true,
  );
  expect(groupRepository(graph, 1).groups.has("apps")).toBe(true);
});

test("folder file views retain incoming and outgoing cross-folder edges without unrelated files", () => {
  const scoped = fileScope(graph, "apps/web");
  expect(scoped.files.map((file) => file.id)).toEqual(["a", "b", "c"]);
  expect(scoped.dependencies.map((edge) => edge.id)).toEqual([
    "ab",
    "cb",
    "ac",
  ]);
  expect(
    fileScope(graph, "packages/core").files.map((file) => file.id),
  ).toEqual(["a", "b", "c"]);
  expect(fileScope(graph, "(root)").files.map((file) => file.id)).toEqual([
    "d",
  ]);
  expect(fileScope(graph, "missing").files).toEqual([]);
});
