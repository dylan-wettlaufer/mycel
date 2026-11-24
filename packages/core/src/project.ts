import { createHistoryQueries } from "./history-queries.js";
import type { HistoryQueries } from "./history-queries.js";
import { createArchitectureQueries } from "./architecture-map.js";
import type { ArchitectureQueries } from "./architecture-map.js";
import { openDatabase } from "@mycel/db";
import type { IndexingSettings, Project, ProjectInfo } from "@mycel/shared";
import type { GraphUpdateTiming } from "./live-index.js";
import { watchRepository } from "./live-index.js";
import { createGraphQueries } from "./queries.js";
import type { GraphQueries } from "./queries.js";

export interface IndexedProjectOptions {
  project: ProjectInfo;
  /** Defaults to the per-repository database outside the source tree. */
  databasePath?: string;
  indexing?: Partial<IndexingSettings>;
  debounceMs?: number;
  onError?(error: unknown): void;
}

export interface IndexedProject {
  project: Project;
  graph: GraphQueries;
  history: HistoryQueries;
  architecture: ArchitectureQueries;
  readonly lastUpdate: GraphUpdateTiming | undefined;
  getSourceWarnings(): string[];
  flush(): Promise<void>;
  close(): void;
}

/** Open storage and commit the initial index before exposing graph queries. */
export async function openIndexedProject(
  options: IndexedProjectOptions,
): Promise<IndexedProject> {
  const database = openDatabase({
    projectRoot: options.project.root,
    ...(options.databasePath === undefined
      ? {}
      : { databasePath: options.databasePath }),
  });
  try {
    const live = await watchRepository({
      project: options.project,
      database,
      onError:
        options.onError ??
        ((error) => console.error("Mycel live index update failed:", error)),
      ...(options.debounceMs === undefined
        ? {}
        : { debounceMs: options.debounceMs }),
      ...(options.indexing === undefined ? {} : { indexing: options.indexing }),
    });
    const shutdown = new AbortController();
    const architecture = createArchitectureQueries({
      projectRoot: live.project.root,
      projectId: live.project.id,
      database,
      signal: shutdown.signal,
      onIndexCommit: live.onCommit,
      onArchitectureFile: live.onArchitectureFile,
      ...(options.debounceMs === undefined
        ? {}
        : { debounceMs: options.debounceMs }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    });
    return {
      project: live.project,
      graph: createGraphQueries(database, live.project.id),
      history: createHistoryQueries(
        database,
        live.project.id,
        live.onEvent,
        shutdown.signal,
      ),
      architecture,
      get lastUpdate() {
        return live.lastUpdate;
      },
      getSourceWarnings: live.getSourceWarnings,
      flush: live.flush,
      close: () => {
        shutdown.abort();
        void live.close();
        if (database.open) database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
