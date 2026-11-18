import type { GraphQueryContext } from "./queries.js";
import type {
  SemanticEntity,
  SemanticGraph,
  SemanticRelationship,
} from "./semantic.js";

export type BehaviourRole =
  "callable" | "ui_event" | "http_request" | "prisma_operation" | "unresolved";
export interface BehaviourTraceQuery {
  direction?: "forward" | "reverse";
  /** Relationship hops, 0–32; defaults to 12. */
  maxDepth?: number;
  /** Terminal paths, 1–100; defaults to 20. */
  maxPaths?: number;
}
export interface BehaviourHop {
  fromId: string;
  toId: string;
  /** HANDLES is traversed endpoint → handler in the forward direction. */
  relationship: SemanticRelationship;
}
export interface BehaviourPath {
  entityIds: string[];
  hops: BehaviourHop[];
  end:
    | "data-access"
    | "unresolved"
    | "no-supported-calls"
    | "no-supported-callers"
    | "depth-limit"
    | "cycle"
    | "work-limit";
  boundary?: { code: string; message: string };
}
export interface BehaviourTrace extends GraphQueryContext {
  rootId: string;
  direction: "forward" | "reverse";
  entities: SemanticEntity[];
  paths: BehaviourPath[];
  truncated: boolean;
}
export interface BehaviourEntryList extends GraphQueryContext {
  entries: SemanticEntity[];
  truncated: boolean;
}

/** Feature membership and the behaviour paths from its own UI events. */
export interface FeatureBehaviour extends SemanticGraph {
  featureId: string;
  traces: BehaviourTrace[];
}
