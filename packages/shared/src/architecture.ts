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

/** Warning emitted when multiple parts match the same file with equal specificity. */
export interface ArchitectureTieWarning {
  /** Repository-relative path of the file that triggered the tie. */
  path: string;
  /** The winning part id (listed first in the architecture definition). */
  winnerPartId: string;
  /** All tied part ids in declaration order, starting with `winnerPartId`. */
  tiedPartIds: string[];
  /** Best matching pattern for each tied part, aligned with `tiedPartIds`. */
  patterns: string[];
}

/** A part paired with its assigned repository-relative files. */
export interface AssignedArchitecturePart extends ArchitecturePart {
  /** Sorted repository-relative paths assigned to this part. */
  files: string[];
  /** True when synthesized from folder fallback for unassigned files. */
  fallback?: boolean;
}

/** Result of assigning indexed files to architecture parts. */
export interface ArchitectureAssignment {
  /**
   * Declared parts in their original order, followed by any fallback parts
   * created for files unmatched by the declared parts.
   */
  parts: AssignedArchitecturePart[];
  /** Mapping from every assigned repository-relative file path to its owning part id. */
  fileToPart: Record<string, string>;
  /**
   * Sorted repository-relative file paths that matched no declared part and
   * were assigned to a fallback part.
   */
  unassignedFiles: string[];
  /** Warnings for files matched by multiple declared parts with identical specificity. */
  tieWarnings: ArchitectureTieWarning[];
}
