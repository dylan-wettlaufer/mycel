import type { ProjectId } from "./project.js";
import type { SourceRange } from "./types.js";

export type NodeKind = "file" | "function" | "class" | "method";
export type SymbolKind = Exclude<NodeKind, "file">;

/** REFERENCES is reserved until its resolution can be implemented reliably. */
export type EdgeKind = "CONTAINS" | "IMPORTS" | "CALLS";

/** Opaque project-scoped identity; source positions are not identity. */
export type NodeId = string;
export type EdgeId = string;

/** Lowercase hexadecimal SHA-256 of exact UTF-8 source, without normalization. */
export type ContentHash = string;

/** Nonnegative safe integer, monotonically increasing per project; 0 is empty. */
export type Revision = number;

export interface GraphNode {
  id: NodeId;
  projectId: ProjectId;
  kind: NodeKind;
  name: string;
  qualifiedName: string;
  /** Repository-relative path with forward slashes. */
  path: string;
  /** The full source range for files, or the declaration range for symbols. */
  range: SourceRange;
  /** Hash of the entire file for file nodes; the source range for symbols. */
  contentHash: ContentHash;
  /** The revision in which this node was last written. */
  revision: Revision;
}

export interface GraphEdge {
  id: EdgeId;
  projectId: ProjectId;
  /** Both endpoints must exist in the same project. */
  sourceId: NodeId;
  targetId: NodeId;
  /** Parent → child, importing file → dependency, or caller → callee. */
  kind: EdgeKind;
  /** The revision in which this edge was last written. */
  revision: Revision;
}
