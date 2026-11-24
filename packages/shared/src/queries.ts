import type {
  ContentHash,
  GraphEdge,
  GraphNode,
  NodeId,
  Revision,
} from "./graph.js";
import type { ProjectId } from "./project.js";
import type { SourceLanguage } from "./languages.js";
import type { Diagnostic } from "./types.js";

/** Options after HTTP parameter parsing; the server validates numeric bounds. */
export interface SearchQuery {
  q: string;
  kind?: "files" | "symbols";
  limit?: number;
}

export interface NeighborhoodQuery {
  depth?: number;
  limit?: number;
}

export interface NodeDetailsQuery {
  /** Maximum number of nodes in each relationship list. */
  limit?: number;
}

export interface FileContentQuery {
  path: string;
  revision?: Revision;
}

/** Identifies the committed graph snapshot used to answer a query. */
export interface GraphQueryContext {
  projectId: ProjectId;
  revision: Revision;
}

export interface NodeList {
  nodes: GraphNode[];
  /** True if matching nodes were omitted because of the query limit. */
  truncated: boolean;
}

export interface SearchResult extends GraphQueryContext, NodeList {}

export interface NodeDetails extends GraphQueryContext {
  node: GraphNode;
  callers: NodeList;
  dependencies: NodeList;
  /** Nodes in this list have kind "file". */
  relatedFiles: NodeList;
  diagnostics: Diagnostic[];
}

export interface EdgeSourceRange {
  /** One-based, inclusive lines in the edge's source file. */
  startLine: number;
  endLine: number;
}

export interface NeighborhoodEdge extends GraphEdge {
  sourceRanges?: EdgeSourceRange[];
}

export interface Neighborhood extends GraphQueryContext {
  rootId: NodeId;
  /** Includes the root, even when traversal is truncated. */
  nodes: GraphNode[];
  /** Every endpoint is present in nodes; no dangling edges are returned. */
  edges: NeighborhoodEdge[];
  /** True if the requested traversal was cut short by its size limit. */
  truncated: boolean;
}

export interface FileContent extends GraphQueryContext {
  /** Repository-relative path, validated by the server against the project root. */
  path: string;
  language: SourceLanguage;
  /** Captured source matching contentHash and the response revision. */
  content: string;
  contentHash: ContentHash;
}

export interface GraphStats extends GraphQueryContext {
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  diagnosticCount: number;
}

export interface ErrorResponse {
  error: string;
}

/** Complete file/import graph for a repository-wide overview, including isolated files. */
export interface RepositoryGraph extends GraphQueryContext {
  files: GraphNode[];
  dependencies: GraphEdge[];
}
