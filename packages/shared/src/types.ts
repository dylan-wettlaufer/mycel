export interface HealthResponse {
  status: "ok";
  /** Absent until the engine is attached; status still describes process liveness. */
  index?: IndexProgress;
  database?: DatabaseStatus;
}

export type IndexStatus = "idle" | "indexing" | "ready" | "error";

export interface IndexProgress {
  status: IndexStatus;
  indexedFiles: number;
  /** Null while discovery has not determined the total. */
  totalFiles: number | null;
  message?: string;
}

export type DatabaseStatus = "closed" | "ready" | "error";

export type SourceLanguage = "typescript" | "tsx";

/** Matches the parser's current supported extensions; .ts includes .d.ts. */
export type SourceExtension = ".ts" | ".tsx";

export interface ProjectInfo {
  name: string;
  root: string;
}

/** UTF-16 offsets, end-exclusive; lines and columns are one-based. */
export interface SourceRange {
  start: number;
  end: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Diagnostic {
  path: string;
  range: SourceRange;
  severity: "error" | "warning";
  source: "parser" | "resolver";
  code: string;
  message: string;
}
