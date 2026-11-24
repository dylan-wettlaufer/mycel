import { once } from "node:events";
import { openIndexedProject, type IndexedProjectOptions } from "@mycel/core";
import type { AppOptions } from "./app.js";
import { startServer } from "./server.js";

export interface IndexedServerOptions
  extends
    Pick<AppOptions, "webDistPath" | "agentHooks">,
    Pick<
      IndexedProjectOptions,
      "project" | "databasePath" | "onInitialProgress"
    > {}

/** Return a listening server with an initial index; close owns storage cleanup. */
export async function startIndexedServer(
  port: number,
  options: IndexedServerOptions,
) {
  const indexed = await openIndexedProject(options);
  let server: ReturnType<typeof startServer> | undefined;
  try {
    server = startServer(port, {
      project: options.project,
      graph: indexed.graph,
      getSourceWarnings: indexed.getSourceWarnings,
      getIndexProgress: indexed.getIndexProgress,
      history: indexed.history,
      architecture: indexed.architecture,
      ...(options.agentHooks === undefined
        ? {}
        : { agentHooks: options.agentHooks }),
      ...(options.webDistPath === undefined
        ? {}
        : { webDistPath: options.webDistPath }),
    });
    server.once("close", indexed.close);
    const close = server.close.bind(server);
    server.close = ((callback?: (error?: Error) => void) => {
      indexed.close();
      return close(callback);
    }) as typeof server.close;
    await once(server, "listening");
    return server;
  } catch (error) {
    if (server?.listening) server.close();
    indexed.close();
    throw error;
  }
}
