import type {
  SemanticEntityKind,
  SemanticProvenance,
  SemanticExtraction,
  SemanticRelationshipKind,
  SemanticSource,
} from "@mycel/shared";
import { hashIdentity } from "../hash.js";

type EvidenceStrength = Pick<SemanticProvenance, "kind" | "confidence">;

/** Accumulate distinct evidence for stable entities and directed relationships. */
export function semanticRecords(
  projectId: string,
  extractor: string,
  version: string,
  strength: EvidenceStrength = { kind: "deterministic", confidence: 1 },
) {
  const entities: SemanticExtraction["entities"] = [];
  const relationships: SemanticExtraction["relationships"] = [];
  const provenance = (rule: string, evidence: EvidenceStrength) => ({
    kind: evidence.kind,
    extractor,
    version,
    rule,
    confidence: evidence.confidence,
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
    evidence: EvidenceStrength = strength,
  ) {
    const id = `semantic:${hashIdentity([projectId, kind, identity])}`;
    const existing = entities.find((item) => item.id === id);
    if (existing) {
      addSource(existing.sources, source);
      if (evidence.confidence > existing.provenance.confidence)
        existing.provenance = provenance(rule, evidence);
    } else
      entities.push({
        id,
        projectId,
        kind,
        name,
        attributes,
        sources: [source],
        provenance: provenance(rule, evidence),
      });
    return id;
  }
  function relationship(
    kind: SemanticRelationshipKind,
    sourceId: string,
    targetId: string,
    source: SemanticSource,
    rule: string,
    evidence: EvidenceStrength = strength,
  ) {
    const id = `semantic-edge:${hashIdentity([projectId, kind, sourceId, targetId, extractor, rule])}`;
    const existing = relationships.find((item) => item.id === id);
    if (existing) {
      addSource(existing.sources, source);
      existing.provenance.confidence = Math.max(
        existing.provenance.confidence,
        evidence.confidence,
      );
    } else
      relationships.push({
        id,
        projectId,
        sourceId,
        targetId,
        kind,
        sources: [source],
        provenance: provenance(rule, evidence),
      });
  }
  return { entity, relationship, entities, relationships };
}
