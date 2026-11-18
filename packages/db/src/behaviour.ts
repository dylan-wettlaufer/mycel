import type {
  BehaviourEntryList,
  BehaviourPath,
  BehaviourTrace,
  BehaviourTraceQuery,
  FeatureBehaviour,
  SemanticEntity,
} from "@mycel/shared";
import type { SqliteDatabase } from "./database.js";
import { getSemanticFeature, readSemanticSelection } from "./semantic.js";

function integer(value: number, min: number, max: number, name: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(
      `${name} must be an integer between ${min} and ${max}`,
    );
}
export function getBehaviourEntries(
  db: SqliteDatabase,
  projectId: string,
  limit = 100,
): BehaviourEntryList {
  integer(limit, 1, 500, "limit");
  return db.transaction(() => {
    const rows = db
      .prepare<[string, number], { id: string }>(
        `SELECT id FROM semantic_entities
      WHERE project_id = ? AND kind = 'service_operation' AND json_extract(attributes, '$.traceRole') = 'ui_event'
      ORDER BY id LIMIT ?`,
      )
      .all(projectId, limit + 1);
    const graph = readSemanticSelection(
      db,
      projectId,
      rows.slice(0, limit).map((row) => row.id),
      rows.length > limit,
      [],
    );
    return {
      projectId,
      revision: graph.revision,
      entries: graph.entities,
      truncated: graph.truncated,
    };
  })();
}

const featureEntryLimit = 8;

/** Match events to member declarations by structural symbol within one revision. */
export function getFeatureBehaviour(
  db: SqliteDatabase,
  projectId: string,
  featureId: string,
  limit = 100,
): FeatureBehaviour | undefined {
  return db.transaction(() => {
    const membership = getSemanticFeature(db, projectId, featureId, limit);
    if (!membership) return;
    const uiMembers = membership.entities
      .filter(({ kind }) => kind === "component" || kind === "page")
      .map(({ id }) => id);
    const entries = db
      .prepare<[string, string, number], { id: string }>(
        `SELECT DISTINCT entry.id
        FROM semantic_sources member_source
        JOIN nodes symbol ON symbol.project_id = member_source.project_id
          AND symbol.id = member_source.node_id AND symbol.kind = 'function'
        JOIN semantic_sources entry_source ON entry_source.project_id = symbol.project_id
          AND entry_source.node_id = symbol.id
        JOIN semantic_entities entry ON entry.project_id = entry_source.project_id
          AND entry.id = entry_source.entity_id
        WHERE member_source.project_id = ?
          AND member_source.entity_id IN (SELECT value FROM json_each(?))
          AND entry.kind = 'service_operation'
          AND json_extract(entry.attributes, '$.traceRole') = 'ui_event'
        ORDER BY entry.id LIMIT ?`,
      )
      .all(projectId, JSON.stringify(uiMembers), featureEntryLimit + 1);
    const traces = entries
      .slice(0, featureEntryLimit)
      .map(({ id }) => traceBehaviour(db, projectId, id)!);
    return {
      ...membership,
      featureId,
      traces,
      truncated:
        membership.truncated ||
        entries.length > featureEntryLimit ||
        traces.some((trace) => trace.truncated),
    };
  })();
}

interface Link {
  id: string;
  fromId: string;
  toId: string;
}
interface State {
  ids: string[];
  links: Link[];
  cycle?: boolean;
}
interface Path extends State {
  end: BehaviourPath["end"];
  boundary?: BehaviourPath["boundary"];
}
const traceRoles =
  "'callable','ui_event','http_request','prisma_operation','unresolved'";

/** Static reference paths only, with a fixed 1,000-edge work budget per query. */
export function traceBehaviour(
  db: SqliteDatabase,
  projectId: string,
  id: string,
  {
    direction = "forward",
    maxDepth = 12,
    maxPaths = 20,
  }: BehaviourTraceQuery = {},
): BehaviourTrace | undefined {
  if (direction !== "forward" && direction !== "reverse")
    throw new RangeError("direction must be forward or reverse");
  integer(maxDepth, 0, 32, "maxDepth");
  integer(maxPaths, 1, 100, "maxPaths");
  return db.transaction(() => {
    // A selected structural function ID resolves to its callable operation. Exact
    // semantic IDs also support requests, events, endpoints, and Prisma models.
    const root = db
      .prepare<[string, string, string, string], { id: string }>(
        `SELECT e.id FROM semantic_entities e
      WHERE e.project_id = ? AND (
        (e.id = ? AND ((e.kind = 'service_operation' AND json_extract(e.attributes, '$.traceRole') IN (${traceRoles}))
          OR e.kind = 'endpoint' OR (e.kind = 'data_model' AND json_extract(e.attributes, '$.provider') = 'prisma')))
        OR (e.kind = 'service_operation' AND (json_extract(e.attributes, '$.traceRole') = 'callable' OR (json_extract(e.attributes, '$.traceRole') = 'unresolved' AND json_extract(e.attributes, '$.callableNodeId') IS NOT NULL))
          AND EXISTS (SELECT 1 FROM semantic_sources s WHERE s.project_id = e.project_id AND s.entity_id = e.id AND s.node_id = ? AND (json_extract(e.attributes, '$.traceRole') = 'callable' OR json_extract(e.attributes, '$.callableNodeId') = s.node_id))))
      ORDER BY CASE WHEN e.id = ? THEN 0 ELSE 1 END, e.id LIMIT 1`,
      )
      .get(projectId, id, id, id);
    if (!root) return;
    const source = direction === "forward" ? "source_id" : "target_id";
    const target = direction === "forward" ? "target_id" : "source_id";
    const logicalSource = `CASE WHEN e.kind = 'HANDLES' THEN e.${target} ELSE e.${source} END`;
    const logicalTarget = `CASE WHEN e.kind = 'HANDLES' THEN e.${source} ELSE e.${target} END`;
    const adjacent = db.prepare<
      [string, string, string, number],
      Link
    >(`SELECT e.id,
      ${logicalSource} AS fromId, ${logicalTarget} AS toId FROM semantic_relationships e
      JOIN semantic_entities s ON s.project_id = e.project_id AND s.id = e.source_id
      JOIN semantic_entities t ON t.project_id = e.project_id AND t.id = e.target_id
      WHERE e.project_id = ?
      AND ((e.kind <> 'HANDLES' AND e.${source} = ?) OR (e.kind = 'HANDLES' AND e.${target} = ?))
      AND json_extract(e.provenance, '$.kind') = 'deterministic'
      AND (
        (e.kind = 'CALLS' AND json_extract(e.provenance, '$.extractor') = 'behaviour-bindings'
          AND s.kind = 'service_operation' AND json_extract(s.attributes, '$.traceRole') IN ('callable','ui_event','http_request')
          AND (t.kind = 'endpoint' OR (t.kind = 'service_operation' AND json_extract(t.attributes, '$.traceRole') IN (${traceRoles}))))
        OR (e.kind = 'HANDLES' AND json_extract(e.provenance, '$.extractor') = 'next-app-router'
          AND json_extract(e.provenance, '$.rule') = 'http-method-export'
          AND json_extract(s.attributes, '$.traceRole') IN ('callable','unresolved') AND t.kind = 'endpoint')
        OR (e.kind IN ('READS','WRITES') AND json_extract(e.provenance, '$.extractor') = 'behaviour-bindings'
          AND json_extract(s.attributes, '$.traceRole') = 'prisma_operation'
          AND t.kind = 'data_model' AND json_extract(t.attributes, '$.provider') = 'prisma')
      ) ORDER BY e.kind, e.id LIMIT ?`);
    const cachedEntities = new Map<string, SemanticEntity>();
    function entity(entityId: string) {
      const cached = cachedEntities.get(entityId);
      if (cached) return cached;
      const found = readSemanticSelection(db, projectId, [entityId], false, [])
        .entities[0]!;
      cachedEntities.set(entityId, found);
      return found;
    }
    const stack: State[] = [{ ids: [root.id], links: [] }];
    const paths: Path[] = [];
    let work = 0;
    let truncated = false;
    while (stack.length && paths.length < maxPaths) {
      const state = stack.pop()!;
      const current = entity(state.ids.at(-1)!);
      if (state.cycle) {
        paths.push({ ...state, end: "cycle" });
        truncated = true;
        continue;
      }
      if (
        direction === "forward" &&
        current.attributes.traceRole === "unresolved"
      ) {
        paths.push({
          ...state,
          end: "unresolved",
          boundary: {
            code: current.attributes.code ?? "unresolved",
            message: current.attributes.message ?? "Unsupported boundary",
          },
        });
        continue;
      }
      if (direction === "forward" && current.kind === "data_model") {
        paths.push({ ...state, end: "data-access" });
        continue;
      }
      const remaining = 1000 - work;
      const links = adjacent.all(
        projectId,
        current.id,
        current.id,
        remaining + 1,
      );
      if (!links.length) {
        paths.push({
          ...state,
          end:
            direction === "forward"
              ? "no-supported-calls"
              : "no-supported-callers",
        });
        continue;
      }
      if (state.links.length === maxDepth) {
        paths.push({ ...state, end: "depth-limit" });
        truncated = true;
        continue;
      }
      if (!remaining) {
        paths.push({ ...state, end: "work-limit" });
        truncated = true;
        continue;
      }
      if (links.length > remaining) truncated = true;
      const supported = links.slice(0, remaining);
      work += supported.length;
      for (const link of supported.reverse())
        stack.push({
          ids: [...state.ids, link.toId],
          links: [...state.links, link],
          ...(state.ids.includes(link.toId) ? { cycle: true } : {}),
        });
    }
    truncated ||= stack.length > 0;
    const ids = [...new Set(paths.flatMap((path) => path.ids))];
    const selectedEdges = [
      ...new Set(paths.flatMap((path) => path.links.map((link) => link.id))),
    ];
    const graph = readSemanticSelection(
      db,
      projectId,
      ids,
      truncated,
      selectedEdges,
    );
    const byId = new Map(graph.relationships.map((edge) => [edge.id, edge]));
    return {
      projectId,
      revision: graph.revision,
      rootId: root.id,
      direction,
      entities: graph.entities,
      paths: paths.map((path) => ({
        entityIds: path.ids,
        hops: path.links.map((link) => ({
          fromId: link.fromId,
          toId: link.toId,
          relationship: byId.get(link.id)!,
        })),
        end: path.end,
        ...(path.boundary ? { boundary: path.boundary } : {}),
      })),
      truncated,
    };
  })();
}
