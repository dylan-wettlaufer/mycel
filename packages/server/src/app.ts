import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { serveStatic } from "@hono/node-server/serve-static";
import { createHistoryRoutes } from "./routes/history.js";
import { createArchitectureRoutes } from "./routes/architecture.js";
import type {
  ArchitectureQueries,
  GraphQueries,
  HistoryQueries,
} from "@mycel/core";
import type {
  AgentHookSetup,
  AgentHookStatus,
  HealthResponse,
  ProjectInfo,
} from "@mycel/shared";
import { Hono } from "hono";
import { createGraphRoutes } from "./routes/graph.js";

export const defaultWebDistPath = fileURLToPath(
  new URL("../../../apps/web/dist/", import.meta.url),
);

export interface AppOptions {
  webDistPath?: string;
  project?: ProjectInfo;
  graph?: GraphQueries;
  history?: HistoryQueries;
  architecture?: ArchitectureQueries;
  agentHooks?: readonly AgentHookSetup[];
}

export function createApp({
  webDistPath = defaultWebDistPath,
  project,
  graph,
  history,
  architecture,
  agentHooks,
}: AppOptions = {}) {
  const app = new Hono<{
    Bindings: { incoming?: { socket: { localPort?: number } } };
  }>();

  app.use("*", async (context, next) => {
    const url = new URL(context.req.url);
    const socket = context.env?.incoming?.socket;
    const port = socket ? socket.localPort : Number(url.port || 80);
    const suffix = port === 80 ? "" : `:${port}`;
    const authority = context.req.header("host") ?? (socket ? "" : url.host);
    const normalized = authority.toLowerCase();
    const validHost = ["localhost", "127.0.0.1"].some(
      (name) =>
        normalized === name + suffix ||
        (port === 80 && normalized === name + ":80"),
    );
    const origin = context.req.header("origin");
    if (
      !validHost ||
      (origin !== undefined &&
        origin !== `http://${normalized.replace(/:80$/, "")}`)
    ) {
      return context.json({ error: "Local dashboard requests only" }, 403);
    }
    return next();
  });

  app.get("/api/health", (context) => {
    const response: HealthResponse = { status: "ok" };
    return context.json(response);
  });

  app.get("/api/project", (context) => {
    if (!project) return context.json({ error: "No repository selected" }, 503);
    return context.json(project);
  });

  app.get("/api/agent-hooks", (context) => {
    const activity = history?.getAgentHookActivity?.();
    const statuses: AgentHookStatus[] = (agentHooks ?? []).map((hook) => {
      const lastReceivedAt = activity?.get(hook.provider);
      return lastReceivedAt === undefined ? hook : { ...hook, lastReceivedAt };
    });
    return context.json(statuses);
  });

  app.get("/api/files/content", (context) => {
    const paths = context.req.queries("path");
    const path = paths?.[0];
    if (
      paths?.length !== 1 ||
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      return context.json({ error: "Invalid repository-relative path" }, 400);
    if (!graph?.getFileContent)
      return context.json({ error: "Source queries unavailable" }, 503);
    const revisions = context.req.queries("revision");
    const requested = revisions?.[0];
    if (
      revisions &&
      (revisions.length !== 1 ||
        !requested ||
        !/^[1-9]\d*$/.test(requested) ||
        !Number.isSafeInteger(Number(requested)))
    )
      return context.json({ error: "Invalid indexed revision" }, 400);
    const file = graph.getFileContent(
      path,
      requested === undefined ? undefined : Number(requested),
    );
    return file
      ? context.json(file)
      : context.json({ error: "Indexed file not found" }, 404);
  });

  app.route("/api/architecture", createArchitectureRoutes(architecture));
  app.route("/api/graph", createGraphRoutes(graph));
  app.route("/api", createHistoryRoutes(history, undefined, architecture));

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
