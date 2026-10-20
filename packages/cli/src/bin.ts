#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { launchDashboard } from "./launch.js";

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      "no-open": { type: "boolean" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.info(`Usage: mycel [options]

Open a live dashboard for the current repository.

Options:
  -h, --help     Show help
  -v, --version  Show version
      --no-open  Start the dashboard without opening a browser

Run from any directory in a Git repository to select its root.
Outside Git, the current folder is used. Press Ctrl+C to stop.`);
    return;
  }

  if (values.version) {
    const manifest: { version: string } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    console.info(manifest.version);
    return;
  }

  const { server, project, url } = await launchDashboard({
    ...(values["no-open"] ? { openBrowser: async () => {} } : {}),
  });

  console.info(`Mycel · ${project.name}\nRepository: ${project.root}\nDashboard: ${url}\nPress Ctrl+C to stop.`);

  server.on("error", (error) => {
    console.error(`Mycel server failed: ${error.message}`);
    process.exitCode = 1;
  });

  const shutdown = () => {
    server.close((error) => {
      if (error) console.error(`Mycel shutdown failed: ${error.message}`);
      process.exit(error ? 1 : 0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(`Mycel: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
