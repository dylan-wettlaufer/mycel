import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultWebDistPath, startIndexedServer } from "@mycel/server";
import open from "open";
import type { IndexProgress } from "@mycel/shared";

import { resolveRepository } from "./repository.js";
import {
  isTemporaryHookInstall,
  setManagedHooks,
  setupAgentHooks,
} from "./setup-agent-hooks.js";

declare const __MYCEL_STANDALONE__: boolean;
const standalone =
  typeof __MYCEL_STANDALONE__ !== "undefined" && __MYCEL_STANDALONE__;
const dashboardPath = standalone
  ? fileURLToPath(new URL("./web/", import.meta.url))
  : defaultWebDistPath;

interface LaunchOptions {
  cwd?: string;
  webDistPath?: string;
  databasePath?: string;
  port?: number;
  openBrowser?: (url: string) => Promise<unknown>;
  agentHooks?: "enabled" | "disabled";
  onInitialProgress?(progress: IndexProgress): void;
}

export async function launchDashboard({
  cwd = process.cwd(),
  webDistPath = dashboardPath,
  databasePath,
  port = 0,
  openBrowser = open,
  agentHooks,
  onInitialProgress,
}: LaunchOptions = {}) {
  const project = await resolveRepository(cwd);
  try {
    await access(join(webDistPath, "index.html"));
  } catch (error) {
    throw new Error(
      standalone
        ? "Dashboard build not found. Reinstall the Mycel npm package."
        : "Dashboard build not found. Run pnpm build in the Mycel workspace first.",
      { cause: error },
    );
  }

  const hookSetup =
    agentHooks === "enabled" && databasePath === undefined
      ? await setupAgentHooks(project.root)
      : undefined;
  // Let the OS choose a free port so other projects and dev servers can coexist.
  const server = await startIndexedServer(port, {
    project,
    webDistPath,
    ...(onInitialProgress && { onInitialProgress }),
    ...(databasePath === undefined ? {} : { databasePath }),
    ...(hookSetup === undefined ? {} : { agentHooks: hookSetup }),
  });
  const captureConfigured = hookSetup?.some(
    ({ state }) => state === "configured",
  );
  if (
    databasePath === undefined &&
    (agentHooks === "disabled" ||
      (agentHooks === "enabled" &&
        (!isTemporaryHookInstall || captureConfigured)))
  ) {
    try {
      await setManagedHooks(project.root, Boolean(captureConfigured));
    } catch (error) {
      for (const hook of hookSetup ?? []) {
        if (hook.state !== "configured") continue;
        hook.state = "error";
        hook.message = "Mycel could not enable capture for this repository";
      }
      console.warn(
        "Mycel could not update automatic agent attribution:",
        error,
      );
    }
  }
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
    console.warn(
      `Could not open the browser (${message}). Open ${url} manually.`,
    );
  }

  return { server, project, url };
}
