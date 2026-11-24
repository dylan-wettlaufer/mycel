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

  routes.get("/behaviour/entries", (context) => {
    const limit = integerParameter(
      context.req.queries("limit"),
      "limit",
      100,
      1,
      500,
    );
    return graph?.getBehaviourEntries
      ? context.json(graph.getBehaviourEntries(limit))
      : context.json({ error: "Behaviour queries unavailable" }, 503);
  });

  routes.get("/behaviour/:id", (context) => {
    const values = context.req.queries("direction");
    const direction = values?.[0] ?? "forward";
    if (
      (values && values.length !== 1) ||
      (direction !== "forward" && direction !== "reverse")
    )
      throw new HTTPException(400, {
        message: "direction must be forward or reverse",
      });
    const maxDepth = integerParameter(
      context.req.queries("maxDepth"),
      "maxDepth",
      12,
      0,
      32,
    );
    const maxPaths = integerParameter(
      context.req.queries("maxPaths"),
      "maxPaths",
      20,
      1,
      100,
    );
    if (!graph?.traceBehaviour)
      return context.json({ error: "Behaviour queries unavailable" }, 503);
    const result = graph.traceBehaviour(context.req.param("id"), {
      direction,
      maxDepth,
      maxPaths,
    });
    return result
      ? context.json(result)
      : context.json({ error: "Trace root not found or unsupported" }, 404);
  });

  routes.get("/semantic/features", (context) => {
    const values = context.req.queries("status");
    const status = values?.[0];
    if (
      values &&
      (values.length !== 1 || (status !== "candidate" && status !== "declared"))
    )
      throw new HTTPException(400, {
        message: "status must be candidate or declared",
      });
    const limit = integerParameter(
      context.req.queries("limit"),
      "limit",
      100,
      1,
      500,
    );
    return graph?.getFeatures
      ? context.json(
          graph.getFeatures({
            ...(status === "candidate" || status === "declared"
              ? { status }
              : {}),
            limit,
          }),
        )
      : context.json({ error: "Feature queries unavailable" }, 503);
  });

  routes.get("/semantic/features/:id", (context) => {
    const limit = integerParameter(
      context.req.queries("limit"),
      "limit",
      100,
      1,
      500,
    );
    if (!graph?.getFeature)
      return context.json({ error: "Feature queries unavailable" }, 503);
    const result = graph.getFeature(context.req.param("id"), limit);
    return result
      ? context.json(result)
      : context.json({ error: "Feature not found" }, 404);
  });

  routes.get("/semantic/features/:id/behaviour", (context) => {
    const limit = integerParameter(
      context.req.queries("limit"),
      "limit",
      100,
      1,
      500,
    );
    if (!graph?.getFeatureBehaviour)
      return context.json({ error: "Feature behaviour unavailable" }, 503);
    const result = graph.getFeatureBehaviour(context.req.param("id"), limit);
    return result
      ? context.json(result)
      : context.json({ error: "Feature not found" }, 404);
  });

  routes.get("/semantic", (context) => {
    const limit = integerParameter(
      context.req.queries("limit"),
      "limit",
      100,
      1,
      500,
    );
    return graph?.getSemanticGraph
      ? context.json(graph.getSemanticGraph(limit))
      : context.json({ error: "Semantic queries unavailable" }, 503);
  });

  routes.get("/semantic/:id/neighborhood", (context) => {
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
    if (!graph?.getSemanticNeighborhood)
      return context.json({ error: "Semantic queries unavailable" }, 503);
    const result = graph.getSemanticNeighborhood(
      context.req.param("id"),
      query,
    );
    return result
      ? context.json(result)
      : context.json({ error: "Semantic entity not found" }, 404);
  });

  routes.get("/repository", (context) =>
    graph?.getRepositoryGraph
      ? context.json(graph.getRepositoryGraph())
      : context.json({ error: "Graph queries unavailable" }, 503),
  );

  routes.get("/stats", (context) =>
    graph?.getStats
      ? context.json(graph.getStats())
      : context.json({ error: "Graph queries unavailable" }, 503),
  );

  routes.get("/search", (context) => {
    const values = context.req.queries("q");
    const q = values?.[0]?.trim();
    if (values?.length !== 1 || !q || q.length > 1000)
      throw new HTTPException(400, {
        message: "q must be a nonempty string of at most 1000 characters",
      });
    const kinds = context.req.queries("kind");
    const kind = kinds?.[0];
    if (
      kinds &&
      (kinds.length !== 1 || (kind !== "files" && kind !== "symbols"))
    )
      throw new HTTPException(400, {
        message: "kind must be files or symbols",
      });
    const query: SearchQuery = {
      q,
      ...(kind === "files" || kind === "symbols" ? { kind } : {}),
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

  routes.get("/nodes/:id/symbols", (context) => {
    if (!graph?.getFileSymbols)
      return context.json({ error: "Graph queries unavailable" }, 503);
    const result = graph.getFileSymbols(context.req.param("id"));
    return result
      ? context.json(result)
      : context.json({ error: "File not found" }, 404);
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
