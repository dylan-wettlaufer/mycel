import { performance } from "node:perf_hooks";
import { replaceProjectGraph } from "@mycel/db";
import type { SqliteDatabase } from "@mycel/db";
import { parseFile } from "@mycel/parser";
import type {
  GraphStats,
  IndexingSettings,
  Project,
  ProjectInfo,
} from "@mycel/shared";
import { discoverSourceFiles } from "./discovery.js";
import { readRepositoryText } from "./files.js";
import { buildProjectGraph, hashIdentity } from "./graph.js";
import type { CapturedFile } from "./graph.js";
import { resolveIndexingSettings } from "./settings.js";

export interface IndexRepositoryOptions {
  project: ProjectInfo;
  database: SqliteDatabase;
  indexing?: Partial<IndexingSettings>;
}

export interface IndexResult extends GraphStats {
  project: Project;
  files: string[];
  durationMs: number;
}

/** Full structural index; source capture completes before any graph writes. */
export async function indexRepository(
  options: IndexRepositoryOptions,
): Promise<IndexResult> {
  const started = performance.now();
  if (typeof options.project.name !== "string" || !options.project.name.trim())
    throw new TypeError("Project name must be nonempty");
  const indexing = resolveIndexingSettings(options.indexing);
  const discovered = await discoverSourceFiles(options.project.root, indexing);
  const project: Project = {
    id: `project:${hashIdentity([discovered.root])}`,
    name: options.project.name,
    root: discovered.root,
    indexing,
  };
  const files: CapturedFile[] = [];
  for (const path of discovered.paths) {
    let source: string;
    try {
      source = await readRepositoryText(discovered.root, path);
    } catch (cause) {
      throw new Error(`Could not read repository source: ${path}`, { cause });
    }
    files.push({ source, parsed: parseFile(path, source) });
  }
  const graph = buildProjectGraph(project, files);
  const revision = replaceProjectGraph(options.database, graph);
  return {
    project,
    projectId: project.id,
    revision,
    files: discovered.paths,
    fileCount: files.length,
    symbolCount: graph.nodes.length - files.length,
    edgeCount: graph.edges.length,
    diagnosticCount: graph.diagnostics.length,
    durationMs: performance.now() - started,
  };
}
