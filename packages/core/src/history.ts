import { isDeepStrictEqual } from "node:util";
import type { EntityChange, ProjectGraph } from "@mycel/db";
import type { GraphEdge, GraphNode } from "@mycel/shared";

type State = {
  nodes: readonly (Omit<GraphNode, "revision"> & { revision?: number })[];
  edges: readonly (Omit<GraphEdge, "revision"> & { revision?: number })[];
};
/** Deterministic ordering; revisions are metadata and do not constitute changes. */
export function diffGraph(
  previous: State,
  next: Pick<ProjectGraph, "nodes" | "edges">,
): EntityChange[] {
  const changes: EntityChange[] = [];
  const paths = new Map(
    [...previous.nodes, ...next.nodes].map((node) => [node.id, node.path]),
  );
  for (const entityType of ["node", "edge"] as const) {
    const key = entityType === "node" ? "nodes" : "edges";
    const strip = (entity: State[typeof key][number]) => {
      const { revision: _revision, ...rest } = entity;
      return rest;
    };
    const before = new Map(
      previous[key].map((entity) => [entity.id, strip(entity)]),
    );
    const after = new Map(
      next[key].map((entity) => [entity.id, strip(entity)]),
    );
    for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const old = before.get(id) ?? null;
      const updated = after.get(id) ?? null;
      if (isDeepStrictEqual(old, updated)) continue;
      const entity = updated ?? old!;
      changes.push({
        entityType,
        entityId: id,
        action:
          old === null ? "created" : updated === null ? "deleted" : "modified",
        path: "path" in entity ? entity.path : paths.get(entity.sourceId)!,
        before: old,
        after: updated,
      });
    }
  }
  return changes;
}
