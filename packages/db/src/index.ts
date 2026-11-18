export { openDatabase } from "./database.js";
export type { OpenDatabaseOptions, SqliteDatabase } from "./database.js";
export { migrateDatabase } from "./migrate.js";
export type { Migration } from "./migrations/index.js";
export { resolveDatabasePath } from "./paths.js";
export { replaceProjectGraph, applyProjectGraph } from "./graph.js";
export type { ProjectGraph } from "./graph.js";
export {
  getFileSymbols,
  getRepositoryGraph,
  getGraphStats,
  getFileContent,
  getNode,
  getNodeDetails,
  searchSymbols,
  getNeighborhood,
  getCallers,
  getDependencies,
} from "./queries.js";
export { commitChangeSet, currentRevision, readGraphState } from "./history.js";
export type { EntityChange, ChangeSet } from "./history.js";
export { listChanges, parseChangeId } from "./history.js";
export { getEventsAfter } from "./history.js";
export { getDiff } from "./history.js";
export { pruneHistory } from "./history.js";
export { startMonitoringSession, endMonitoringSession } from "./sessions.js";

export {
  getSemanticGraph,
  getSemanticNeighborhood,
  getSemanticFeatures,
  getSemanticFeature,
} from "./semantic.js";
export {
  getBehaviourEntries,
  getFeatureBehaviour,
  traceBehaviour,
} from "./behaviour.js";
