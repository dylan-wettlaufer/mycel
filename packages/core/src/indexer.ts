import { loadModuleResolver } from "./module-resolution.js";
import { performance } from "node:perf_hooks";
import { getFileContent, replaceProjectGraph } from "@mycel/db";
import type { SqliteDatabase } from "@mycel/db";
import { parseFile } from "@mycel/parser";
import type {
  GraphStats,
  IndexingSettings,
  Project,
  ProjectInfo,
} from "@mycel/shared";
import { discoverSourceFiles } from "./discovery.js";
import {
  isMissing,
  readRepositoryText,
  sourceReadDiagnostic,
} from "./files.js";
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
  const { project, files, paths, resolution, readErrors } =
    await captureRepository(options);
  const graph = buildProjectGraph(project, files, resolution);
  const indexed = new Set(paths);
  graph.diagnostics = [
    ...graph.diagnostics,
    ...[...readErrors].map(([path, reason]) =>
      sourceReadDiagnostic(path, reason, indexed.has(path)),
    ),
  ];
  const revision = replaceProjectGraph(options.database, graph);
  return {
    project,
    projectId: project.id,
    revision,
    files: paths,
    fileCount: files.length,
    symbolCount: graph.nodes.length - files.length,
    edgeCount: graph.edges.length,
    diagnosticCount: graph.diagnostics.length,
    durationMs: performance.now() - started,
  };
}

export async function captureRepository(
  options: Pick<IndexRepositoryOptions, "project" | "indexing"> &
    Partial<Pick<IndexRepositoryOptions, "database">>,
  parse: typeof parseFile = parseFile,
) {
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
  const readErrors = new Map<string, string>();
  for (const path of discovered.paths) {
    let source: string;
    try {
      source = await readRepositoryText(discovered.root, path);
    } catch (cause) {
      if (isMissing(cause)) continue;
      readErrors.set(
        path,
        cause instanceof Error ? cause.message : String(cause),
      );
      const previous =
        options.database && getFileContent(options.database, project.id, path);
      if (!previous) continue;
      source = previous.content;
    }
    files.push({ source, parsed: parse(path, source) });
  }
  const paths = files.map((file) => file.parsed.path);
  const resolution = await loadModuleResolver(
    discovered.root,
    paths,
    discovered.metadataPaths,
  );
  return {
    project,
    files,
    paths,
    readErrors,
    resolution,
    metadataPaths: discovered.metadataPaths,
  };
}
