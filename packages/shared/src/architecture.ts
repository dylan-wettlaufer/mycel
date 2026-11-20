import type { Revision } from "./graph.js";
import type { ProjectId } from "./project.js";

export type ArchitecturePartKind =
  "app" | "service" | "library" | "data" | "integration" | "cli";

export type ArchitectureSource = "agent" | "folder-fallback";

export interface ArchitectureSubcomponent {
  /** Stable lowercase slug, unique among siblings. */
  id: string;
  name: string;
  /** One line describing what the part is for. */
  purpose: string;
  /** Repository-relative globs selecting the part's files or folders. */
  paths: string[];
}

/** One logical part of the codebase. Connections are computed by Mycel, never declared. */
export interface ArchitecturePart extends ArchitectureSubcomponent {
  kind: ArchitecturePartKind;
  /** The first responsibility is selected when opening the component map. */
  subcomponents?: ArchitectureSubcomponent[];
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
  /** The catch-all group for files outside a component's named responsibilities. */
  unassigned?: boolean;
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

export type ArchitectureEvidenceKind = "import" | "call";

/** One resolved import or call backing a connection between two parts. */
export interface ArchitectureConnectionEvidence {
  kind: ArchitectureEvidenceKind;
  /** Repository-relative path of the importing or calling file. */
  file: string;
  /** 1-based source line in `file`. */
  line: number;
  /** Other indexed lines for the same relationship, in source order. */
  additionalLines?: number[];
  /** Indexed import locations that contain only type imports for this target. */
  typeOnlyImportLines?: number[];
  /** The index only has the enclosing file or declaration location. */
  approximate?: boolean;
  /** Repository-relative path of the imported or called target file. */
  targetFile: string;
  /** Calling symbol qualified name when `kind` is `"call"` inside a symbol. */
  sourceSymbol?: string;
  /** Target symbol qualified name when `kind` is `"call"`. */
  symbol?: string;
}

/** Aggregated directed dependency from one architecture part to another. */
export interface ArchitectureConnection {
  /** Deterministic id (`${sourcePartId}->${targetPartId}`). */
  id: string;
  sourcePartId: string;
  targetPartId: string;
  /** Total resolved cross-part links (`importCount + callCount`). */
  count: number;
  /** Number of resolved cross-part `IMPORTS` edges. */
  importCount: number;
  /** Number of resolved cross-part `CALLS` edges. */
  callCount: number;
  /** Deterministically sorted evidence items backing this connection. */
  evidence: ArchitectureConnectionEvidence[];
  /** True when `evidence` was capped by a limit; counts remain exact. */
  truncated: boolean;
}

export type ArchitectureChangeWindow = "uncommitted" | "branch" | "7d" | "30d";

export type ArchitectureChangeStatus = "new" | "changed" | "unchanged";

/** File-level git changes for a requested architecture comparison window. */
export interface ArchitectureGitChanges {
  /** False when the directory is not a git repository or git cannot be run. */
  available: boolean;
  /** Short machine-readable reason when `available` is false. */
  reason?: string;
  /** The window requested by the caller. */
  requestedWindow: ArchitectureChangeWindow;
  /**
   * The effective window applied. `"branch"` resolves to `"7d"` when on the
   * default branch or detached HEAD.
   */
  resolvedWindow: ArchitectureChangeWindow;
  /** Current branch name, or `null` when detached or unavailable. */
  branch: string | null;
  /** Base branch ref used for `"branch"` diffs (such as `"main"`), or `null`. */
  baseRef: string | null;
  /** Base commit SHA used for the diff, or `null` when uncommitted-only or empty history. */
  baseCommit: string | null;
  /** Sorted repository-relative paths that did not exist before the window. */
  addedFiles: string[];
  /** Sorted repository-relative paths that existed before the window and changed. */
  modifiedFiles: string[];
  /** Sorted repository-relative paths deleted within the window. */
  deletedFiles: string[];
  /** Sorted repository-relative paths with uncommitted working-tree changes. */
  uncommittedFiles: string[];
}

export interface ArchitecturePartChange {
  status: ArchitectureChangeStatus;
  /** True when any file in this part has uncommitted working-tree changes. */
  uncommitted: boolean;
  addedFiles: number;
  modifiedFiles: number;
  uncommittedFiles: number;
}

export interface ArchitectureConnectionChange {
  status: ArchitectureChangeStatus;
  /** True when any backing evidence endpoint has uncommitted working-tree changes. */
  uncommitted: boolean;
}

export interface ArchitecturePartWithChanges extends AssignedArchitecturePart {
  change: ArchitecturePartChange;
  /** A neighboring top-level component shown in a scoped map. */
  boundary?: boolean;
}

export interface ArchitectureConnectionWithChanges extends ArchitectureConnection {
  change: ArchitectureConnectionChange;
}

/** Complete architecture map snapshot returned by `GET /api/architecture`. */
export interface ArchitectureMap {
  projectId: ProjectId;
  revision: Revision;
  /** `"agent"` when loaded from `.mycel/architecture.json`, `"folder-fallback"` otherwise. */
  source: ArchitectureSource;
  /** Present for a map inside a top-level component. */
  component?: { id: string; name: string };
  /** Present when `.mycel/architecture.json` supplied a `generatedAt` timestamp. */
  generatedAt?: string;
  /** Validation issues when `.mycel/architecture.json` exists but is invalid. */
  fileIssues?: ArchitectureIssue[];
  /** Parts with assigned files and git change status. */
  parts: ArchitecturePartWithChanges[];
  /** Directed cross-part connections with evidence and git change status. */
  connections: ArchitectureConnectionWithChanges[];
  /** Git change metadata for the selected window. */
  changes: ArchitectureGitChanges;
  /** Files not matched by any declared part (assigned to fallback parts). */
  unassignedFiles: string[];
  /** Tie warnings when multiple declared parts match a file with identical specificity. */
  tieWarnings: ArchitectureTieWarning[];
}

export type ArchitectureUpdateReason = "file" | "index" | "git";

/** SSE notification emitted when the architecture map should be refreshed. */
export interface ArchitectureUpdateEvent {
  projectId: ProjectId;
  revision: Revision;
  reason: ArchitectureUpdateReason;
  timestamp: string;
}
