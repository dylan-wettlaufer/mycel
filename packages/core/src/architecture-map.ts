import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { watch } from "chokidar";
import {
  currentRevision,
  getCrossFileLinks,
  getRepositoryGraph,
} from "@mycel/db";
import type { SqliteDatabase } from "@mycel/db";
import type {
  ArchitectureChangeWindow,
  ArchitectureFile,
  ArchitectureIssue,
  ArchitectureMap,
  ArchitectureSource,
  ArchitectureUpdateEvent,
  ArchitectureUpdateReason,
  ProjectId,
} from "@mycel/shared";
import { architectureFilePath, parseArchitectureFile } from "./architecture.js";
import { assignFilesToParts } from "./architecture-assign.js";
import { computeArchitectureConnections } from "./architecture-connections.js";
import { buildFallbackArchitecture } from "./architecture-fallback.js";
import type { FallbackArchitectureOptions } from "./architecture-fallback.js";
import {
  applyGitChangesToArchitecture,
  collectGitChanges,
} from "./architecture-git.js";
import { isMissing, readRepositoryText } from "./files.js";

const execFileAsync = promisify(execFile);

export interface LoadedProjectArchitecture {
  architecture: ArchitectureFile;
  source: ArchitectureSource;
  fallback: ArchitectureFile;
  /** False only when `.mycel/architecture.json` does not exist. */
  fileFound: boolean;
  fileIssues?: ArchitectureIssue[];
}

export interface ArchitectureMapQueryOptions {
  /** Recent-change window. Defaults to `"branch"`. */
  window?: ArchitectureChangeWindow;
  /** Optional cap on evidence entries per connection; counts stay exact. */
  evidenceLimit?: number;
  /** Reference timestamp for `"7d"` and `"30d"` windows (defaults to `new Date()`). */
  now?: Date;
}

export interface BuildArchitectureMapOptions extends ArchitectureMapQueryOptions {
  projectRoot: string;
  projectId: ProjectId;
  database: SqliteDatabase;
  fallbackOptions?: FallbackArchitectureOptions;
}

export interface ArchitectureQueries {
  getArchitecture(
    options?: ArchitectureMapQueryOptions,
  ): Promise<ArchitectureMap>;
  onUpdate(listener: (event: ArchitectureUpdateEvent) => void): () => void;
  signal: AbortSignal;
}

export interface CreateArchitectureQueriesOptions {
  projectRoot: string;
  projectId: ProjectId;
  database: SqliteDatabase;
  signal: AbortSignal;
  debounceMs?: number;
  onIndexCommit?(listener: (revision: number) => void): () => void;
  onArchitectureFile?(listener: () => void): () => void;
  onError?(error: unknown): void;
}

const gitWatchedFiles = new Set([
  "HEAD",
  "index",
  "packed-refs",
  "MERGE_HEAD",
  "REBASE_HEAD",
]);

/**
 * Load `.mycel/architecture.json` if present and valid; otherwise generate the
 * folder/workspace fallback architecture. Validation errors are returned in
 * `fileIssues` rather than failing the architecture map.
 */
export async function loadProjectArchitecture(
  projectRoot: string,
  fallbackOptions?: FallbackArchitectureOptions,
): Promise<LoadedProjectArchitecture> {
  const fallback = await buildFallbackArchitecture(
    projectRoot,
    fallbackOptions,
  );
  let text: string | undefined;
  try {
    text = await readRepositoryText(projectRoot, architectureFilePath);
  } catch (error) {
    if (!isMissing(error)) {
      return {
        architecture: fallback,
        source: "folder-fallback",
        fallback,
        fileFound: true,
        fileIssues: [
          {
            path: "",
            message: `Could not read ${architectureFilePath}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  if (text === undefined) {
    return {
      architecture: fallback,
      source: "folder-fallback",
      fallback,
      fileFound: false,
    };
  }

  const parsed = parseArchitectureFile(text);
  if (!parsed.ok) {
    return {
      architecture: fallback,
      source: "folder-fallback",
      fallback,
      fileFound: true,
      fileIssues: parsed.issues,
    };
  }

  return {
    architecture: parsed.file,
    source: parsed.file.source ?? "agent",
    fallback,
    fileFound: true,
  };
}

/**
 * Assemble a complete architecture map snapshot combining `.mycel/architecture.json`
 * (or folder fallback), file-to-part assignment, cross-part import/call connections,
 * and recent git change status.
 */
export async function buildArchitectureMap(
  options: BuildArchitectureMapOptions,
): Promise<ArchitectureMap> {
  const { evidenceLimit } = options;
  if (
    evidenceLimit !== undefined &&
    (!Number.isSafeInteger(evidenceLimit) || evidenceLimit < 1)
  ) {
    throw new RangeError("evidenceLimit must be a safe integer >= 1");
  }

  const repository = getRepositoryGraph(options.database, options.projectId);
  const linksSnapshot = getCrossFileLinks(options.database, options.projectId);
  const filePaths = repository.files.map((file) => file.path);

  const [loaded, gitChanges] = await Promise.all([
    loadProjectArchitecture(options.projectRoot, {
      ...options.fallbackOptions,
      filePaths,
    }),
    collectGitChanges(options.projectRoot, {
      ...(options.window === undefined ? {} : { window: options.window }),
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
  ]);

  const assignment = assignFilesToParts(loaded.architecture, filePaths, {
    fallback: loaded.fallback,
  });

  // Compute full connections before applying git status so evidence caps cannot hide changes.
  const fullConnections = computeArchitectureConnections(
    assignment,
    linksSnapshot.links,
  );
  const annotated = applyGitChangesToArchitecture(
    assignment,
    fullConnections,
    gitChanges,
  );

  const connections =
    evidenceLimit === undefined
      ? annotated.connections
      : annotated.connections.map((connection) => {
          const truncated = connection.evidence.length > evidenceLimit;
          return {
            ...connection,
            evidence: truncated
              ? connection.evidence.slice(0, evidenceLimit)
              : connection.evidence,
            truncated,
          };
        });

  const map: ArchitectureMap = {
    projectId: options.projectId,
    revision: linksSnapshot.revision,
    source: loaded.source,
    parts: annotated.parts,
    connections,
    changes: gitChanges,
    unassignedFiles: assignment.unassignedFiles,
    tieWarnings: assignment.tieWarnings,
  };
  if (loaded.architecture.generatedAt !== undefined) {
    map.generatedAt = loaded.architecture.generatedAt;
  }
  if (loaded.fileIssues !== undefined) {
    map.fileIssues = loaded.fileIssues;
  }
  return map;
}

async function resolveGitDir(projectRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-dir"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    const raw = stdout.trim();
    if (!raw) return undefined;
    return await realpath(resolve(projectRoot, raw));
  } catch {
    return undefined;
  }
}

/**
 * Create architecture query and live update subscription handlers for an
 * indexed project. Emits updates when `.mycel/architecture.json`, the code
 * index, or git state changes.
 */
export function createArchitectureQueries(
  options: CreateArchitectureQueriesOptions,
): ArchitectureQueries {
  const debounceMs = options.debounceMs ?? 75;
  const listeners = new Set<(event: ArchitectureUpdateEvent) => void>();
  const timers = new Map<
    ArchitectureUpdateReason,
    ReturnType<typeof setTimeout>
  >();
  let gitWatcher: ReturnType<typeof watch> | undefined;
  let closed = options.signal.aborted;

  function emit(reason: ArchitectureUpdateReason, revision?: number) {
    if (closed || listeners.size === 0) return;
    let resolvedRevision = revision;
    if (resolvedRevision === undefined) {
      if (!options.database.open) return;
      try {
        resolvedRevision = currentRevision(options.database, options.projectId);
      } catch {
        return;
      }
    }
    const event: ArchitectureUpdateEvent = {
      projectId: options.projectId,
      revision: resolvedRevision,
      reason,
      timestamp: new Date().toISOString(),
    };
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        options.onError?.(error);
      }
    }
  }

  function schedule(reason: ArchitectureUpdateReason, revision?: number) {
    if (closed) return;
    const existing = timers.get(reason);
    if (existing) clearTimeout(existing);
    if (debounceMs === 0) {
      emit(reason, revision);
      return;
    }
    timers.set(
      reason,
      setTimeout(() => {
        timers.delete(reason);
        emit(reason, revision);
      }, debounceMs),
    );
  }

  const unsubscribers: (() => void)[] = [];
  if (options.onIndexCommit) {
    unsubscribers.push(
      options.onIndexCommit((revision) => {
        emit("index", revision);
      }),
    );
  }
  if (options.onArchitectureFile) {
    unsubscribers.push(
      options.onArchitectureFile(() => {
        schedule("file");
      }),
    );
  }

  // Start watching git state files lazily without blocking startup.
  if (!closed) {
    void resolveGitDir(options.projectRoot).then((gitDir) => {
      if (closed || !gitDir) return;
      const watcher = watch(gitDir, {
        ignoreInitial: true,
        followSymlinks: false,
        depth: 5,
        ignored: (targetPath) => {
          const rel = relative(gitDir, targetPath).split(sep).join("/");
          if (!rel) return false;
          if (rel.endsWith(".lock")) return true;
          if (gitWatchedFiles.has(rel)) return false;
          if (
            rel === "refs" ||
            rel === "refs/heads" ||
            rel.startsWith("refs/heads/")
          ) {
            return false;
          }
          return true;
        },
      });
      watcher.on("all", (kind, targetPath) => {
        if (
          closed ||
          (kind !== "add" && kind !== "change" && kind !== "unlink")
        )
          return;
        const rel = relative(gitDir, targetPath).split(sep).join("/");
        if (
          rel.endsWith(".lock") ||
          (!gitWatchedFiles.has(rel) && !rel.startsWith("refs/heads/"))
        )
          return;
        schedule("git");
      });
      watcher.on("error", (error) => {
        if (!closed) options.onError?.(error);
      });
      if (closed) {
        void watcher.close();
      } else {
        gitWatcher = watcher;
      }
    });
  }

  const cleanup = () => {
    closed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers.length = 0;
    listeners.clear();
    if (gitWatcher) {
      const watcher = gitWatcher;
      gitWatcher = undefined;
      void watcher.close();
    }
  };

  if (options.signal.aborted) {
    cleanup();
  } else {
    options.signal.addEventListener("abort", cleanup, { once: true });
  }

  return {
    getArchitecture(queryOptions?: ArchitectureMapQueryOptions) {
      return buildArchitectureMap({
        projectRoot: options.projectRoot,
        projectId: options.projectId,
        database: options.database,
        ...queryOptions,
      });
    },
    onUpdate(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    signal: options.signal,
  };
}
