import {
  getSemanticGraph,
  getSemanticNeighborhood,
  getFileSymbols,
  getRepositoryGraph,
  getGraphStats,
  getFileContent,
  getNeighborhood,
  getNodeDetails,
  searchSymbols,
} from "@mycel/db";
import type { SqliteDatabase } from "@mycel/db";
import type {
  Neighborhood,
  NeighborhoodQuery,
  NodeDetails,
  NodeDetailsQuery,
  NodeId,
  ProjectId,
  SearchQuery,
  SearchResult,
  SemanticGraph,
} from "@mycel/shared";

/** Project-scoped reads; consumers cannot select a different project per request. */
export interface GraphQueries {
  getSemanticGraph?(limit?: number): SemanticGraph;
  getSemanticNeighborhood?(
    id: string,
    query?: NeighborhoodQuery,
  ): SemanticGraph | undefined;
  getFileSymbols?(id: NodeId): SearchResult | undefined;
  getRepositoryGraph?(): import("@mycel/shared").RepositoryGraph;
  getStats?(): import("@mycel/shared").GraphStats;
  getFileContent?(
    path: string,
  ): import("@mycel/shared").FileContent | undefined;
  searchSymbols(query: SearchQuery): SearchResult;
  getNodeDetails(id: NodeId, query?: NodeDetailsQuery): NodeDetails | undefined;
  getNeighborhood(
    id: NodeId,
    query?: NeighborhoodQuery,
  ): Neighborhood | undefined;
}

/** The caller owns the database and must keep it open while serving queries. */
export function createGraphQueries(
  database: SqliteDatabase,
  projectId: ProjectId,
): GraphQueries {
  return {
    getSemanticGraph: (limit) => getSemanticGraph(database, projectId, limit),
    getSemanticNeighborhood: (id, { depth, limit } = {}) =>
      getSemanticNeighborhood(database, projectId, id, depth, limit),
    getFileSymbols: (id) => getFileSymbols(database, projectId, id),
    getRepositoryGraph: () => getRepositoryGraph(database, projectId),
    getStats: () => getGraphStats(database, projectId),
    getFileContent: (path) => getFileContent(database, projectId, path),
    searchSymbols: ({ q, limit }) =>
      searchSymbols(database, projectId, q, limit),
    getNodeDetails: (id, { limit } = {}) =>
      getNodeDetails(database, projectId, id, limit),
    getNeighborhood: (id, { depth, limit } = {}) =>
      getNeighborhood(database, projectId, id, depth, limit),
  };
}
