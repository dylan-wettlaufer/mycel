import type { GraphEdge, GraphNode, NodeKind, Revision } from "./graph.js";
import type { ProjectId } from "./project.js";
import type { ChangeAttribution } from "./agents.js";

export type ChangeAction = "created" | "modified" | "deleted";
/** Decimal string representation of a database-wide monotonically increasing id. */
export type ChangeId = string;
export interface RelationshipEndpoint {
  id: string;
  path: string;
  qualifiedName: string;
}

/** Evidence from the indexed revision in which this relationship existed. */
export interface RecordedRelationship {
  kind: "IMPORTS" | "CALLS";
  source: RelationshipEndpoint;
  target: RelationshipEndpoint;
  startLine: number;
  endLine: number;
  approximate?: boolean;
  features: { id: string; name: string }[];
}

export interface FileChangeSummary {
  symbols: { name: string; action: ChangeAction }[];
  symbolCount: number;
  addedCalls: number;
  removedCalls: number;
  addedImports: number;
  removedImports: number;
}

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
  relationship?: RecordedRelationship;
  fileSummary?: FileChangeSummary;
  sessionId?: string;
  attribution?: ChangeAttribution;
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

export interface ChangesQuery {
  cursor?: ChangeId;
  limit?: number;
  kind?: "files" | "relationships";
  nodeId?: string;
}
export interface ChangesPage {
  items: ChangeEvent[];
  cursor: ChangeId | null;
}
export interface ChangeDiff {
  changeId: ChangeId;
  path: string;
  beforeContent: string | null;
  afterContent: string | null;
  beforeRevision: Revision | null;
  afterRevision: Revision | null;
}

export type SseMessage =
  | { type: "change"; data: ChangeEvent }
  | { type: "attribution"; data: Record<string, never> }
  | {
      type: "architecture";
      data: import("./architecture.js").ArchitectureUpdateEvent;
    }
  | { type: "index-status"; data: import("./types.js").IndexProgress }
  | {
      type: "diagnostics";
      data: {
        projectId: ProjectId;
        revision: Revision;
        items: import("./types.js").Diagnostic[];
      };
    };
