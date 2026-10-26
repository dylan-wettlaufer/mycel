import { openDatabase } from "@mycel/db";
import type { IndexingSettings, Project, ProjectInfo } from "@mycel/shared";
import { indexRepository } from "./indexer.js";
import { createGraphQueries } from "./queries.js";
import type { GraphQueries } from "./queries.js";

export interface IndexedProjectOptions {
  project: ProjectInfo;
  /** Defaults to the per-repository database outside the source tree. */
  databasePath?: string;
  indexing?: Partial<IndexingSettings>;
}

export interface IndexedProject {
  project: Project;
  graph: GraphQueries;
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
    const { project } = await indexRepository({
      project: options.project,
      database,
      ...(options.indexing === undefined ? {} : { indexing: options.indexing }),
    });
    return {
      project,
      graph: createGraphQueries(database, project.id),
      close: () => {
        if (database.open) database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
