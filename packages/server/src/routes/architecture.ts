import type { ArchitectureQueries } from "@mycel/core";
import type { ArchitectureChangeWindow, ErrorResponse } from "@mycel/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

const allowedWindows = new Set<ArchitectureChangeWindow>([
  "uncommitted",
  "branch",
  "7d",
  "30d",
]);

function parseWindow(
  values: string[] | undefined,
): ArchitectureChangeWindow | undefined {
  if (values === undefined) return undefined;
  const value = values[0];
  if (
    values.length !== 1 ||
    value === undefined ||
    !allowedWindows.has(value as ArchitectureChangeWindow)
  ) {
    throw new HTTPException(400, {
      message: "window must be uncommitted, branch, 7d, or 30d",
    });
  }
  return value as ArchitectureChangeWindow;
}

function parseEvidenceLimit(values: string[] | undefined): number | undefined {
  if (values === undefined) return 100;
  const value = values[0];
  if (values.length !== 1 || value === undefined || !/^\d+$/.test(value)) {
    throw new HTTPException(400, {
      message: "evidenceLimit must be an integer between 1 and 500",
    });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new HTTPException(400, {
      message: "evidenceLimit must be an integer between 1 and 500",
    });
  }
  return parsed;
}

function parseComponent(components: string[] | undefined): string | undefined {
  const componentId = components?.[0];
  if (
    components &&
    (components.length !== 1 ||
      !componentId ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(componentId))
  ) {
    throw new HTTPException(400, {
      message: "component must be a top-level part id",
    });
  }
  return componentId;
}

export function createArchitectureRoutes(architecture?: ArchitectureQueries) {
  const routes = new Hono();

  routes.onError((error, context) => {
    if (error instanceof HTTPException) {
      return context.json(
        { error: error.message } satisfies ErrorResponse,
        error.status,
      );
    }
    console.error("Architecture query failed:", error);
    return context.json(
      { error: "Architecture query failed" } satisfies ErrorResponse,
      500,
    );
  });

  routes.get("/", async (context) => {
    const window = parseWindow(context.req.queries("window"));
    const evidenceLimit = parseEvidenceLimit(
      context.req.queries("evidenceLimit"),
    );
    const componentId = parseComponent(context.req.queries("component"));
    if (!architecture) {
      return context.json(
        { error: "Architecture queries unavailable" } satisfies ErrorResponse,
        503,
      );
    }
    const map = await architecture.getArchitecture({
      ...(componentId === undefined ? {} : { componentId }),
      ...(window === undefined ? {} : { window }),
      ...(evidenceLimit === undefined ? {} : { evidenceLimit }),
    });
    if (componentId && !map.component) {
      throw new HTTPException(404, {
        message: "Component breakdown unavailable",
      });
    }
    return context.json(map);
  });

  routes.get("/parts/:id/walkthrough", async (context) => {
    const component = parseComponent(context.req.queries("component"));
    if (!architecture?.getPartWalkthrough)
      return context.json({ error: "Walkthrough unavailable" }, 503);
    const result = await architecture.getPartWalkthrough(
      context.req.param("id"),
      component,
    );
    return result
      ? context.json(result)
      : context.json({ error: "Part not found" }, 404);
  });

  return routes;
}
