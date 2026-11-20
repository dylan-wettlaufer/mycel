export { discoverSourceFiles } from "./discovery.js";
export type { DiscoveredSources } from "./discovery.js";
export { indexRepository } from "./indexer.js";
export type { IndexRepositoryOptions, IndexResult } from "./indexer.js";
export { createGraphQueries } from "./queries.js";
export type { GraphQueries } from "./queries.js";
export { openIndexedProject } from "./project.js";
export type { IndexedProject, IndexedProjectOptions } from "./project.js";
export { watchSourceFiles } from "./watcher.js";
export type { SourceChange, SourceWatcherOptions } from "./watcher.js";
export { createSourceChangeQueue } from "./changes.js";
export type { SourceBatch, SourceChangeQueueOptions } from "./changes.js";
export { watchRepository } from "./live-index.js";
export type {
  GraphUpdateTiming,
  WatchRepositoryOptions,
} from "./live-index.js";

export { architectureFilePath, parseArchitectureFile } from "./architecture.js";
export { buildFallbackArchitecture } from "./architecture-fallback.js";
export type { FallbackArchitectureOptions } from "./architecture-fallback.js";
export {
  assignFilesToParts,
  findUnmatchedPatterns,
  inspectComponentAssignments,
} from "./architecture-assign.js";
export type { AssignFilesOptions } from "./architecture-assign.js";
export {
  computeArchitectureConnections,
  extractCrossFileLinks,
  getArchitectureConnections,
  readWorkingTreeLinks,
} from "./architecture-connections.js";
export type {
  ArchitectureConnectionsSnapshot,
  ComputeConnectionsOptions,
  GraphLinkSource,
} from "./architecture-connections.js";
export {
  applyGitChangesToArchitecture,
  collectGitChanges,
} from "./architecture-git.js";
export type { GitChangesOptions } from "./architecture-git.js";
export {
  buildArchitectureMap,
  createArchitectureQueries,
  loadProjectArchitecture,
} from "./architecture-map.js";
export type {
  ArchitectureMapQueryOptions,
  ArchitectureQueries,
  BuildArchitectureMapOptions,
  CreateArchitectureQueriesOptions,
  LoadedProjectArchitecture,
} from "./architecture-map.js";

export { createHistoryQueries } from "./history-queries.js";
export type { HistoryQueries } from "./history-queries.js";

export { extractSemanticGraph } from "./semantic/index.js";
export type {
  SemanticExtractor,
  SemanticContext,
  SemanticInput,
} from "./semantic/index.js";
