export type ArchitecturePartKind =
  "app" | "service" | "library" | "data" | "integration" | "cli";

export type ArchitectureSource = "agent" | "folder-fallback";

/** One logical part of the codebase. Connections are computed by Mycel, never declared. */
export interface ArchitecturePart {
  /** Stable lowercase slug, unique within the file. */
  id: string;
  name: string;
  /** One line describing what the part is for. */
  purpose: string;
  kind: ArchitecturePartKind;
  /** Repository-relative globs selecting the part's files or folders. */
  paths: string[];
}

/** Contents of `.mycel/architecture.json`. */
export interface ArchitectureFile {
  version: 1;
  source?: ArchitectureSource;
  /** ISO 8601 timestamp with a UTC offset. */
  generatedAt?: string;
  parts: ArchitecturePart[];
}

export interface ArchitectureIssue {
  /** JSON path to the invalid value, such as `parts.0.paths.1`; empty for the whole file. */
  path: string;
  message: string;
}

export type ArchitectureFileResult =
  | { ok: true; file: ArchitectureFile }
  | { ok: false; issues: ArchitectureIssue[] };
