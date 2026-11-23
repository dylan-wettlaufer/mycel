import { claudeCodeAdapter } from "@mycel/agents";
import { recordAgentToolEvent } from "@mycel/db";
import { resolveRepository } from "./repository.js";

export async function runClaudeCodeHook(
  stdin: AsyncIterable<Buffer>,
  cwd: string,
  databasePath?: string,
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
    throw new Error("Expected a Claude Code hook JSON payload on stdin");
  }
  const { root } = await resolveRepository(cwd);
  const event = claudeCodeAdapter.capture(input, root, receivedAt);
  if (event) recordAgentToolEvent(root, event, databasePath);
}
