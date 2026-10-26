import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { serveStatic } from "@hono/node-server/serve-static";
import type { GraphQueries } from "@mycel/core";
import type { HealthResponse, ProjectInfo } from "@mycel/shared";
import { Hono } from "hono";
import { createGraphRoutes } from "./routes/graph.js";

export const defaultWebDistPath = fileURLToPath(
  new URL("../../../apps/web/dist/", import.meta.url),
);

export interface AppOptions {
  webDistPath?: string;
  project?: ProjectInfo;
  graph?: GraphQueries;
}

export function createApp({
  webDistPath = defaultWebDistPath,
  project,
  graph,
}: AppOptions = {}) {
  const app = new Hono();

  app.get("/api/health", (context) => {
    const response: HealthResponse = { status: "ok" };
    return context.json(response);
  });

  app.get("/api/project", (context) => {
    if (!project) return context.json({ error: "No repository selected" }, 503);
    return context.json(project);
  });

  app.route("/api/graph", createGraphRoutes(graph));

  // API misses must never fall through to the frontend's HTML entry point.
  app.all("/api", (context) => context.json({ error: "Not found" }, 404));
  app.all("/api/*", (context) => context.json({ error: "Not found" }, 404));

  app.use("*", serveStatic({ root: webDistPath }));

  const serveIndex = serveStatic({ path: join(webDistPath, "index.html") });
  app.get("*", async (context, next) => {
    // Support browser navigation to client routes, but preserve missing assets.
    if (
      !context.req.header("accept")?.includes("text/html") ||
      context.req.path.startsWith("/assets/") ||
      extname(context.req.path)
    ) {
      return context.notFound();
    }
    return (await serveIndex(context, next)) ?? context.notFound();
  });

  return app;
}
