#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { isAgentProvider } from "@mycel/shared";

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      "no-open": { type: "boolean" },
      "no-agent-hooks": { type: "boolean" },
      managed: { type: "boolean" },
      component: { type: "string" },
    },
    allowPositionals: true,
  });

  const [command, provider] = positionals;
  const isAgentHook =
    command === "agent-hook" &&
    isAgentProvider(provider) &&
    positionals.length === 2;
  const isHistory =
    command === "history" &&
    positionals.length === 2 &&
    (provider === "status" || provider === "clear");
  if (
    positionals.length &&
    !isAgentHook &&
    !isHistory &&
    (!["architecture", "install-skill"].includes(command ?? "") ||
      positionals.length !== 1)
  )
    throw new Error(`Unexpected argument: ${positionals.join(" ")}`);
  if (values.component !== undefined && command !== "architecture")
    throw new Error("--component requires the architecture command");
  if (values.managed && !isAgentHook)
    throw new Error("--managed requires the agent-hook command");

  if (values.help) {
    console.info(`Usage: mycel [options]
       mycel architecture [--component <name-or-id>]
       mycel history <status|clear>
       mycel install-skill
       mycel agent-hook <claude-code|codex|cursor>

Open a live dashboard for the current repository.

Commands:
  architecture   Validate .mycel/architecture.json and list unassigned files,
                 tie warnings and unmatched patterns. Exits with 1 when the
                 file is missing or invalid, or a pattern matches no file.
                 With --component, show the selected component's files, links,
                 and responsibility assignments.
  history        Inspect source storage and event counts, or clear past history
                 while retaining the current index.
  install-skill  Add the mycel-architecture agent skill to .agents/skills
                 (Codex) and .claude/skills (Claude Code) in this repository.
  agent-hook     Record coding agent hook metadata from stdin for local attribution.

Options:
  -h, --help     Show help
  -v, --version  Show version
      --no-open  Start the dashboard without opening a browser
      --no-agent-hooks  Turn off automatic agent attribution for this repository

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

  if (command === "architecture") {
    const { checkArchitecture } = await import("./architecture.js");
    await checkArchitecture(values.component);
    return;
  }

  if (command === "install-skill") {
    const { installSkill } = await import("./skill.js");
    await installSkill();
    return;
  }

  if (isHistory) {
    const { historyCommand } = await import("./history.js");
    await historyCommand(provider);
    return;
  }

  if (isAgentHook) {
    const { runAgentHook } = await import("./agent-hook.js");
    await runAgentHook(
      provider,
      process.stdin,
      process.cwd(),
      undefined,
      values.managed,
    );
    return;
  }

  const { launchDashboard } = await import("./launch.js");
  const { server, project, url } = await launchDashboard({
    agentHooks: values["no-agent-hooks"] ? "disabled" : "enabled",
    ...(values["no-open"] ? { openBrowser: async () => {} } : {}),
  });

  console.info(
    `Mycel · ${project.name}\nRepository: ${project.root}\nDashboard: ${url}\nPress Ctrl+C to stop.`,
  );

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
  console.error(
    `Mycel: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
