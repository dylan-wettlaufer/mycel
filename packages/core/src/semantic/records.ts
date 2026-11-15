import type {
  SemanticEntityKind,
  SemanticExtraction,
  SemanticRelationshipKind,
  SemanticSource,
} from "@mycel/shared";
import { hashIdentity } from "../hash.js";

/** Accumulate distinct evidence for stable entities and directed relationships. */
export function semanticRecords(
  projectId: string,
  extractor: string,
  version: string,
) {
  const entities: SemanticExtraction["entities"] = [];
  const relationships: SemanticExtraction["relationships"] = [];
  const provenance = (rule: string) => ({
    kind: "deterministic" as const,
    extractor,
    version,
    rule,
    confidence: 1,
  });
  function addSource(sources: SemanticSource[], source: SemanticSource) {
    if (
      !sources.some(
        (item) =>
          item.nodeId === source.nodeId &&
          item.range.start === source.range.start &&
          item.range.end === source.range.end,
      )
    )
      sources.push(source);
  }
  function entity(
    kind: SemanticEntityKind,
    identity: string,
    name: string,
    source: SemanticSource,
    rule: string,
    attributes: Record<string, string> = {},
  ) {
    const id = `semantic:${hashIdentity([projectId, kind, identity])}`;
    const existing = entities.find((item) => item.id === id);
    if (existing) addSource(existing.sources, source);
    else
      entities.push({
        id,
        projectId,
        kind,
        name,
        attributes,
        sources: [source],
        provenance: provenance(rule),
      });
    return id;
  }
  function relationship(
    kind: SemanticRelationshipKind,
    sourceId: string,
    targetId: string,
    source: SemanticSource,
    rule: string,
  ) {
    const id = `semantic-edge:${hashIdentity([projectId, kind, sourceId, targetId, extractor, rule])}`;
    const existing = relationships.find((item) => item.id === id);
    if (existing) addSource(existing.sources, source);
    else
      relationships.push({
        id,
        projectId,
        sourceId,
        targetId,
        kind,
        sources: [source],
        provenance: provenance(rule),
      });
  }
  return { entity, relationship, entities, relationships };
}
