import { posix } from "node:path";
import type { SemanticExtraction, SemanticSource } from "@mycel/shared";
import type { SemanticContext } from "./context.js";
import { nextRouteLocation } from "./next.js";
import { semanticRecords } from "./records.js";

type Entity = SemanticExtraction["entities"][number];
type Relationship = SemanticExtraction["relationships"][number];
const genericDirectories = new Set([
  "shared",
  "common",
  "ui",
  "components",
  "services",
  "utils",
  "lib",
]);
const implementationKinds = new Set([
  "route",
  "page",
  "component",
  "service_operation",
  "endpoint",
]);

/** Organizational candidates over existing declarations and forward semantic links. */
export function discoverFeatures(
  context: SemanticContext,
  graph: Readonly<SemanticExtraction>,
): SemanticExtraction {
  const records = semanticRecords(
    context.project.id,
    "feature-discovery",
    "1",
    { kind: "heuristic", confidence: 0.65 },
  );
  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const declared = new Map(
    graph.entities
      .filter(
        (entity) =>
          entity.kind === "feature" &&
          entity.provenance.kind === "deterministic",
      )
      .map((entity) => [entity.name, entity]),
  );
  const explicit = new Map<string, Set<string>>();
  const explicitNodes = new Map<string, Set<string>>();
  const outgoing = new Map<string, Relationship[]>();
  for (const edge of graph.relationships) {
    if (
      edge.kind === "IMPLEMENTS" &&
      edge.provenance.kind === "deterministic" &&
      entities.get(edge.targetId)?.kind === "feature"
    ) {
      const features = explicit.get(edge.sourceId) ?? new Set<string>();
      features.add(edge.targetId);
      explicit.set(edge.sourceId, features);
      for (const source of entities.get(edge.sourceId)?.sources ?? []) {
        const targets = explicitNodes.get(source.nodeId) ?? new Set<string>();
        targets.add(edge.targetId);
        explicitNodes.set(source.nodeId, targets);
      }
    }
    if (
      ["RENDERS", "CALLS", "HANDLES"].includes(edge.kind) &&
      edge.provenance.kind === "deterministic"
    ) {
      const edges = outgoing.get(edge.sourceId) ?? [];
      edges.push(edge);
      outgoing.set(edge.sourceId, edges);
    }
  }
  function assignments(entity: Entity): Set<string> {
    return new Set(
      entity.sources.flatMap((source) => [
        ...(explicitNodes.get(source.nodeId) ?? []),
      ]),
    );
  }
  function candidate(
    name: string,
    source: SemanticSource,
    rule: string,
    confidence: number,
    scope: string,
  ) {
    const existing = declared.get(name);
    if (existing) return existing.id;
    return records.entity(
      "feature",
      `discovered:${scope}:${name}`,
      name,
      source,
      rule,
      { status: "candidate", scope },
      { kind: "heuristic", confidence },
    );
  }
  function traverse(
    featureId: string,
    start: Entity,
    sources: SemanticSource[],
    confidence: number,
    rule: string,
  ) {
    const pending = [{ entity: start, sources, confidence, rule, depth: 0 }];
    const visited = new Set<string>();
    for (let index = 0; index < pending.length; index++) {
      const entry = pending[index]!;
      const { entity } = entry;
      if (visited.has(entity.id) || !implementationKinds.has(entity.kind))
        continue;
      visited.add(entity.id);
      const assigned = assignments(entity);
      if (assigned.size && !assigned.has(featureId)) continue;
      const evidence = [...entry.sources, ...entity.sources];
      if (!explicit.get(entity.id)?.has(featureId)) {
        for (const source of evidence)
          records.relationship(
            "IMPLEMENTS",
            entity.id,
            featureId,
            source,
            entry.rule,
            { kind: "heuristic", confidence: entry.confidence },
          );
      }
      if (entry.depth === 8) continue;
      for (const edge of outgoing.get(entity.id) ?? []) {
        const target = entities.get(edge.targetId);
        if (!target) continue;
        pending.push({
          entity: target,
          sources: [...evidence, ...edge.sources],
          confidence: Number(
            (Math.min(entry.confidence, 0.65) * 0.9).toFixed(3),
          ),
          rule: "semantic-path",
          depth: entry.depth + 1,
        });
      }
    }
  }
  // A source tag is authoritative for every semantic role on that declaration.
  for (const [entityId, features] of explicit) {
    const entity = entities.get(entityId)!;
    for (const id of features)
      traverse(id, entity, entities.get(id)!.sources, 0.8, "explicit-seed");
  }
  const layouts = graph.entities.filter(
    (entity) =>
      entity.kind === "component" &&
      entity.sources.some(
        (source) =>
          posix.basename(source.path) === "layout.tsx" &&
          nextRouteLocation(context, source.path),
      ),
  );
  for (const route of graph.entities.filter(
    (entity) => entity.kind === "route",
  )) {
    const source = route.sources[0];
    if (!source) continue;
    const location = nextRouteLocation(context, source.path);
    const pageEdge = outgoing
      .get(route.id)
      ?.find((edge) => entities.get(edge.targetId)?.kind === "page");
    const page = pageEdge && entities.get(pageEdge.targetId);
    if (!location || !page) continue;
    const tags = assignments(page);
    const segment = location.publicSegments.find(
      (name) => !name.startsWith("["),
    );
    const group = location.groups.at(-1);
    if (!tags.size && !segment && !group) continue;
    const confidence = tags.size || segment ? 0.8 : 0.6;
    const ids = tags.size
      ? [...tags]
      : [
          candidate(
            segment ?? group!,
            source,
            segment ? "route-area" : "route-group",
            confidence,
            location.packageRoot,
          ),
        ];
    for (const id of ids) {
      const evidence = [
        ...route.sources,
        ...page.sources,
        ...(pageEdge?.sources ?? []),
        ...(tags.has(id) ? (entities.get(id)?.sources ?? []) : []),
      ];
      traverse(
        id,
        route,
        evidence,
        confidence,
        tags.size ? "annotated-route" : segment ? "route-area" : "route-group",
      );
      for (const layout of layouts) {
        const mapping = layout.sources.find(
          (item) => posix.basename(item.path) === "layout.tsx",
        );
        if (!mapping) continue;
        const layoutLocation = nextRouteLocation(context, mapping.path);
        const directory = posix.dirname(mapping.path);
        const pageDirectory = posix.dirname(source.path);
        if (
          layoutLocation?.directory !== location.directory ||
          (pageDirectory !== directory &&
            !pageDirectory.startsWith(`${directory}/`))
        )
          continue;
        traverse(
          id,
          layout,
          [...evidence, mapping],
          Math.min(confidence, 0.7),
          "layout-convention",
        );
      }
    }
  }
  for (const entity of graph.entities) {
    if (
      !["component", "page", "service_operation"].includes(entity.kind) ||
      assignments(entity).size
    )
      continue;
    for (const source of entity.sources) {
      const segments = source.path.split("/");
      const index = segments.lastIndexOf("features");
      const name = index < 0 ? undefined : segments[index + 1];
      if (
        !name ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) ||
        genericDirectories.has(name.toLowerCase())
      )
        continue;
      const scope = context.resolution?.packageRoot?.(source.path) ?? "";
      const feature = candidate(name, source, "feature-directory", 0.65, scope);
      traverse(feature, entity, [source], 0.65, "feature-directory");
    }
  }
  return { entities: records.entities, relationships: records.relationships };
}
