import { getNeighborhood, getNodeDetails, searchSymbols } from "@mycel/db";
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
} from "@mycel/shared";

/** Project-scoped reads; consumers cannot select a different project per request. */
export interface GraphQueries {
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
    searchSymbols: ({ q, limit }) =>
      searchSymbols(database, projectId, q, limit),
    getNodeDetails: (id, { limit } = {}) =>
      getNodeDetails(database, projectId, id, limit),
    getNeighborhood: (id, { depth, limit } = {}) =>
      getNeighborhood(database, projectId, id, depth, limit),
  };
}
