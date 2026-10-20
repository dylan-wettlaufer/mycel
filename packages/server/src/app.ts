import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { serveStatic } from "@hono/node-server/serve-static";
import type { HealthResponse, ProjectInfo } from "@mycel/shared";
import { Hono } from "hono";

export const defaultWebDistPath = fileURLToPath(
  new URL("../../../apps/web/dist/", import.meta.url),
);

export interface AppOptions {
  webDistPath?: string;
  project?: ProjectInfo;
}

export function createApp({ webDistPath = defaultWebDistPath, project }: AppOptions = {}) {
  const app = new Hono();

  app.get("/api/health", (context) => {
    const response: HealthResponse = { status: "ok" };
    return context.json(response);
  });

  app.get("/api/project", (context) => {
    if (!project) return context.json({ error: "No repository selected" }, 503);
    return context.json(project);
  });

  // API misses must never fall through to the frontend's HTML entry point.
  app.all("/api", (context) => context.notFound());
  app.all("/api/*", (context) => context.notFound());

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
