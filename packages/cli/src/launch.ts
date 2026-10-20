import { once } from "node:events";
import { access } from "node:fs/promises";
import { join } from "node:path";

import { defaultWebDistPath, startServer } from "@mycel/server";
import open from "open";

import { resolveRepository } from "./repository.js";

interface LaunchOptions {
  cwd?: string;
  webDistPath?: string;
  openBrowser?: (url: string) => Promise<unknown>;
}

export async function launchDashboard({
  cwd = process.cwd(),
  webDistPath = defaultWebDistPath,
  openBrowser = open,
}: LaunchOptions = {}) {
  const project = await resolveRepository(cwd);
  try {
    await access(join(webDistPath, "index.html"));
  } catch (error) {
    throw new Error("Dashboard build not found. Run pnpm build in the Mycel workspace first.", { cause: error });
  }

  // Let the OS choose a free port so other projects and dev servers can coexist.
  const server = startServer(0, { project, webDistPath });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not determine the dashboard address");
  }
  const url = `http://127.0.0.1:${address.port}`;

  try {
    await openBrowser(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Could not open the browser (${message}). Open ${url} manually.`);
  }

  return { server, project, url };
}
