import { agentAdapters } from "@mycel/agents";
import { existsSync } from "node:fs";
import { recordAgentToolEvents } from "@mycel/db";
import type { AgentProvider } from "@mycel/shared";
import { resolveRepository } from "./repository.js";
import {
  hasProjectAgentHooks,
  managedHookMarker,
} from "./setup-agent-hooks.js";

export async function runAgentHook(
  provider: AgentProvider,
  stdin: AsyncIterable<Buffer>,
  cwd: string,
  databasePath?: string,
  managed = false,
): Promise<void> {
  const receivedAt = Date.now();
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) return;
    chunks.push(chunk);
  }

  let input: unknown;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error(`Expected a ${provider} hook JSON payload on stdin`);
  }
  const adapter = agentAdapters[provider];
  const project = await resolveRepository(
    adapter.projectDirectory?.(input) ?? cwd,
  ).catch((error: unknown) => {
    if (!managed) throw error;
    return undefined;
  });
  if (
    !project ||
    (managed && !existsSync(managedHookMarker(project.root, databasePath)))
  )
    return;
  const { root } = project;
  if (managed && (await hasProjectAgentHooks(root, provider))) return;
  recordAgentToolEvents(
    root,
    adapter.capture(input, root, receivedAt),
    databasePath,
  );
}
