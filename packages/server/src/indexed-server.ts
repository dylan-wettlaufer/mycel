import { once } from "node:events";
import { openIndexedProject } from "@mycel/core";
import type { ProjectInfo } from "@mycel/shared";
import type { AppOptions } from "./app.js";
import { startServer } from "./server.js";

export interface IndexedServerOptions extends Pick<AppOptions, "webDistPath"> {
  project: ProjectInfo;
  databasePath?: string;
}

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
      ...(options.webDistPath === undefined
        ? {}
        : { webDistPath: options.webDistPath }),
    });
    server.once("close", indexed.close);
    await once(server, "listening");
    return server;
  } catch (error) {
    if (server?.listening) server.close();
    indexed.close();
    throw error;
  }
}
