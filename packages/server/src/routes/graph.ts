import type { GraphQueries } from "@mycel/core";
import type {
  ErrorResponse,
  NeighborhoodQuery,
  NodeDetailsQuery,
  SearchQuery,
} from "@mycel/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

function integerParameter(
  values: string[] | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (values === undefined) return fallback;
  const value = values[0];
  if (values.length !== 1 || value === undefined || !/^\d+$/.test(value))
    throw new HTTPException(400, {
      message: `${name} must be an integer between ${minimum} and ${maximum}`,
    });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new HTTPException(400, {
      message: `${name} must be an integer between ${minimum} and ${maximum}`,
    });
  return parsed;
}

export function createGraphRoutes(graph?: GraphQueries) {
  const routes = new Hono();

  routes.onError((error, context) => {
    if (error instanceof HTTPException) {
      return context.json(
        { error: error.message } satisfies ErrorResponse,
        error.status,
      );
    }
    console.error("Graph query failed:", error);
    return context.json(
      { error: "Graph query failed" } satisfies ErrorResponse,
      500,
    );
  });

  routes.get("/search", (context) => {
    const values = context.req.queries("q");
    const q = values?.[0]?.trim();
    if (values?.length !== 1 || !q || q.length > 1000)
      throw new HTTPException(400, {
        message: "q must be a nonempty string of at most 1000 characters",
      });
    const query: SearchQuery = {
      q,
      limit: integerParameter(
        context.req.queries("limit"),
        "limit",
        20,
        1,
        100,
      ),
    };
    if (!graph)
      return context.json(
        { error: "Graph queries unavailable" } satisfies ErrorResponse,
        503,
      );
    return context.json(graph.searchSymbols(query));
  });

  routes.get("/nodes/:id", (context) => {
    const query: NodeDetailsQuery = {
      limit: integerParameter(
        context.req.queries("limit"),
        "limit",
        100,
        1,
        100,
      ),
    };
    if (!graph)
      return context.json(
        { error: "Graph queries unavailable" } satisfies ErrorResponse,
        503,
      );
    const details = graph.getNodeDetails(context.req.param("id"), query);
    if (!details)
      return context.json(
        { error: "Node not found" } satisfies ErrorResponse,
        404,
      );
    return context.json(details);
  });

  routes.get("/nodes/:id/neighborhood", (context) => {
    const query: NeighborhoodQuery = {
      depth: integerParameter(context.req.queries("depth"), "depth", 1, 0, 5),
      limit: integerParameter(
        context.req.queries("limit"),
        "limit",
        100,
        1,
        500,
      ),
    };
    if (!graph)
      return context.json(
        { error: "Graph queries unavailable" } satisfies ErrorResponse,
        503,
      );
    const neighborhood = graph.getNeighborhood(context.req.param("id"), query);
    if (!neighborhood)
      return context.json(
        { error: "Node not found" } satisfies ErrorResponse,
        404,
      );
    return context.json(neighborhood);
  });

  return routes;
}
