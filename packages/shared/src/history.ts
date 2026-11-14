import type { GraphEdge, GraphNode, NodeKind, Revision } from "./graph.js";
import type { ProjectId } from "./project.js";

export type ChangeAction = "created" | "modified" | "deleted";
/** Decimal string representation of a database-wide monotonically increasing id. */
export type ChangeId = string;
export interface ChangeEvent {
  id: ChangeId;
  projectId: ProjectId;
  timestamp: string;
  entityType: "node" | "edge";
  entityId: string;
  action: ChangeAction;
  path: string;
  beforeRevision: Revision | null;
  afterRevision: Revision | null;
  before: GraphNode | GraphEdge | null;
  after: GraphNode | GraphEdge | null;
  sessionId?: string;
  attribution?: {
    status: "confirmed" | "inferred" | "unknown";
    sessionId?: string;
  };
}
/** Dashboard presentation of an event; graph events retain full before/after data. */
export interface ActivityEvent {
  id: string;
  kind: ChangeAction;
  symbolKind: NodeKind;
  name: string;
  path: string;
  occurredAt: string;
}
export type ChangeKind = ChangeAction;
