import type { AgentProvider, AgentToolEvent } from "@mycel/shared";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";

export interface AgentAdapter {
  projectDirectory?(input: unknown): string | undefined;
  capture(
    input: unknown,
    projectRoot: string,
    receivedAt: number,
  ): readonly AgentToolEvent[];
}

export const agentAdapters: Record<AgentProvider, AgentAdapter> = {
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
};
