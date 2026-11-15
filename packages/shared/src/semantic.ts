import type { GraphQueryContext } from "./queries.js";
import type { SourceRange } from "./types.js";

export type SemanticEntityKind =
  | "feature"
  | "route"
  | "page"
  | "component"
  | "endpoint"
  | "service_operation"
  | "data_model"
  | "external_dependency";

/** READS/WRITES require explicit evidence; an import or type reference is insufficient. */
export type SemanticRelationshipKind =
  | "RENDERS"
  | "HANDLES"
  | "CALLS"
  | "READS"
  | "WRITES"
  | "IMPLEMENTS"
  | "DEPENDS_ON";

export interface SemanticProvenance {
  kind: "deterministic" | "heuristic" | "ai";
  extractor: string;
  version: string;
  rule: string;
  /** Evidence strength in [0, 1], not a runtime execution probability. */
  confidence: number;
}

export interface SemanticSource {
  /** Structural file or symbol node in the same project. */
  nodeId: string;
  path: string;
  range: SourceRange;
}

export interface SemanticEntity {
  id: string;
  projectId: string;
  kind: SemanticEntityKind;
  name: string;
  attributes: Record<string, string>;
  sources: SemanticSource[];
  provenance: SemanticProvenance;
  revision: number;
}

export interface SemanticRelationship {
  id: string;
  projectId: string;
  sourceId: string;
  targetId: string;
  kind: SemanticRelationshipKind;
  sources: SemanticSource[];
  provenance: SemanticProvenance;
  revision: number;
}

export interface SemanticGraph extends GraphQueryContext {
  entities: SemanticEntity[];
  relationships: SemanticRelationship[];
  truncated: boolean;
}

/** Complete extraction output for one captured structural snapshot. */
export interface SemanticExtraction {
  entities: Omit<SemanticEntity, "revision">[];
  relationships: Omit<SemanticRelationship, "revision">[];
}
