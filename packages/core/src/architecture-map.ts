import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { watch } from "chokidar";
import {
  currentRevision,
  getBehaviourEntries,
  getCrossFileLinks,
  getRepositoryGraph,
  listRecentRelationships,
} from "@mycel/db";
import type { SqliteDatabase } from "@mycel/db";
import type {
  ArchitectureChangeWindow,
  ArchitectureConnectionEvidence,
  ArchitectureFile,
  ArchitectureIssue,
  ArchitectureMap,
  ArchitectureRelationshipChange,
  ArchitectureSource,
  ArchitectureUpdateEvent,
  ArchitectureUpdateReason,
  PartWalkthrough,
  ProjectId,
} from "@mycel/shared";
import { architectureFilePath, parseArchitectureFile } from "./architecture.js";
import {
  assignComponentFiles,
  assignFilesToParts,
} from "./architecture-assign.js";
import { computeArchitectureConnections } from "./architecture-connections.js";
import { buildFallbackArchitecture } from "./architecture-fallback.js";
import type { FallbackArchitectureOptions } from "./architecture-fallback.js";
import {
  applyGitChangesToArchitecture,
  collectGitChanges,
  trackConnectionEndpoints,
} from "./architecture-git.js";
import { isMissing, readRepositoryText } from "./files.js";
import {
  loadAgentProposals,
  validateAgentProposals,
} from "./agent-proposals.js";

const execFileAsync = promisify(execFile);
const evidenceSiteLimit = 20;

function limitEvidenceSites(
  item: ArchitectureConnectionEvidence,
): ArchitectureConnectionEvidence {
  const { additionalLines, typeOnlyImportLines } = item;
  if (!additionalLines || additionalLines.length < evidenceSiteLimit)
    return item;

  const lastLine = additionalLines[evidenceSiteLimit - 2]!;
  return {
    ...item,
    siteCount: additionalLines.length + 1,
    additionalLines: additionalLines.slice(0, evidenceSiteLimit - 1),
    ...(typeOnlyImportLines && {
      typeOnlyImportLines: typeOnlyImportLines
        .slice(0, evidenceSiteLimit)
        .filter((line) => line <= lastLine),
    }),
  };
}

export interface LoadedProjectArchitecture {
  architecture: ArchitectureFile;
  source: ArchitectureSource;
  fallback: ArchitectureFile;
  /** False only when `.mycel/architecture.json` does not exist. */
  fileFound: boolean;
  fileIssues?: ArchitectureIssue[];
}

export interface ArchitectureMapQueryOptions {
  /** Scope the map to a top-level component with named subcomponents. */
  componentId?: string;
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
  getPartWalkthrough?(
    partId: string,
    componentId?: string,
  ): Promise<PartWalkthrough | undefined>;
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
  const repository = getRepositoryGraph(options.database, options.projectId);
  const linksSnapshot = getCrossFileLinks(options.database, options.projectId);
  const filePaths = repository.files.map((file) => file.path);
  const recent = listRecentRelationships(
    options.database,
    options.projectId,
    new Date(
      (options.now ?? new Date()).getTime() - 7 * 86_400_000,
    ).toISOString(),
  );

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

  const topLevel = assignFilesToParts(
    loaded.architecture,
    options.componentId
      ? [...filePaths, ...gitChanges.deletedFiles]
      : filePaths,
    { fallback: loaded.fallback },
  );
  const parent = topLevel.parts.find(
    ({ id, subcomponents }) =>
      id === options.componentId && subcomponents?.length,
  );
  const assignment = parent
    ? assignComponentFiles(topLevel, parent, new Set(filePaths))
    : topLevel;
  const inside = (id: string) =>
    parent !== undefined && id.startsWith(`${parent.id}:`);

  const endpoints = trackConnectionEndpoints(gitChanges);
  const retainedConnections = computeArchitectureConnections(
    assignment,
    linksSnapshot.links,
    {
      ...(options.evidenceLimit === undefined
        ? {}
        : { evidenceLimit: options.evidenceLimit }),
      onEvidence: endpoints.record,
    },
  ).filter(
    (edge) => !parent || inside(edge.sourcePartId) || inside(edge.targetPartId),
  );
  const annotated = applyGitChangesToArchitecture(
    assignment,
    retainedConnections,
    gitChanges,
    parent ? assignment.fileToPart : undefined,
    endpoints.byConnection,
  );

  const indexedPaths = new Set(filePaths);
  const historicalPaths = recent
    .flatMap(({ relationship }) =>
      relationship ? [relationship.source.path, relationship.target.path] : [],
    )
    .filter((path) => !indexedPaths.has(path));
  const historicalTop = historicalPaths.length
    ? assignFilesToParts(
        loaded.architecture,
        [...filePaths, ...historicalPaths],
        { fallback: loaded.fallback },
      )
    : topLevel;
  const historicalParent =
    parent && historicalTop.parts.find(({ id }) => id === parent.id);
  const owners =
    historicalParent && historicalTop !== topLevel
      ? assignComponentFiles(historicalTop, historicalParent, indexedPaths)
      : parent
        ? assignment
        : historicalTop;
  const partsById = new Map(
    [...owners.parts, ...assignment.parts].map((part) => [part.id, part.name]),
  );
  const partForPath = (path: string) =>
    assignment.fileToPart[path] ?? owners.fileToPart[path];
  const relationshipChanges: ArchitectureRelationshipChange[] = [];
  const changesByConnection = new Map<string, string[]>();
  for (const { id, entityId, action, relationship } of recent) {
    if (!relationship || (action !== "created" && action !== "deleted"))
      continue;
    const sourcePartId = partForPath(relationship.source.path);
    const targetPartId = partForPath(relationship.target.path);
    if (
      !sourcePartId ||
      !targetPartId ||
      sourcePartId === targetPartId ||
      (parent && !inside(sourcePartId) && !inside(targetPartId))
    )
      continue;
    relationshipChanges.push({
      id,
      edgeId: entityId,
      action,
      relationship,
      sourcePartId,
      targetPartId,
      sourcePartName: partsById.get(sourcePartId) ?? sourcePartId,
      targetPartName: partsById.get(targetPartId) ?? targetPartId,
    });
    const key = `${sourcePartId}->${targetPartId}`;
    const ids = changesByConnection.get(key) ?? [];
    ids.push(id);
    changesByConnection.set(key, ids);
  }
  const connections = annotated.connections.map((connection) => {
    const ids = changesByConnection.get(connection.id);
    return {
      ...connection,
      evidence: connection.evidence.map(limitEvidenceSites),
      change: {
        ...connection.change,
        ...(ids ? { relationshipChangeIds: ids } : {}),
      },
    };
  });

  const connected = new Set(
    connections.flatMap(({ sourcePartId, targetPartId }) => [
      sourcePartId,
      targetPartId,
    ]),
  );
  const map: ArchitectureMap = {
    projectId: options.projectId,
    revision: linksSnapshot.revision,
    source: loaded.source,
    ...(parent ? { component: { id: parent.id, name: parent.name } } : {}),
    parts: parent
      ? annotated.parts
          .filter(({ id }) => inside(id) || connected.has(id))
          .map((entry) =>
            inside(entry.id) ? entry : { ...entry, boundary: true },
          )
      : annotated.parts,
    connections,
    relationshipChanges,
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
    async getPartWalkthrough(partId, componentId) {
      const repository = getRepositoryGraph(
        options.database,
        options.projectId,
      );
      const filePaths = repository.files.map(({ path }) => path);
      const [loaded, proposals] = await Promise.all([
        loadProjectArchitecture(options.projectRoot, { filePaths }),
        loadAgentProposals(options.projectRoot),
      ]);
      const topLevel = assignFilesToParts(loaded.architecture, filePaths, {
        fallback: loaded.fallback,
      });
      const parent = topLevel.parts.find(
        ({ id, subcomponents }) => id === componentId && subcomponents?.length,
      );
      if (componentId && !parent) return undefined;
      const assignment = parent
        ? assignComponentFiles(topLevel, parent, new Set(filePaths))
        : topLevel;
      const part = assignment.parts.find(({ id }) => id === partId);
      if (!part) return undefined;

      return options.database.transaction(() => {
        const result = getBehaviourEntries(
          options.database,
          options.projectId,
          100,
          part.files,
        );
        if (result.revision !== repository.revision)
          throw new Error("The index changed during the walkthrough query");
        return {
          ...result,
          proposals: validateAgentProposals(
            options.database,
            result,
            assignment.fileToPart,
            partId,
            proposals.records,
          ),
          ...(proposals.error && { proposalError: proposals.error }),
        };
      })();
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
