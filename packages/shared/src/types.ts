export interface HealthResponse {
  status: "ok";
}

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
