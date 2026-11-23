import type { AgentToolEvent } from "@mycel/shared";

export interface AgentAdapter {
  capture(
    input: unknown,
    projectRoot: string,
    receivedAt: number,
  ): AgentToolEvent | undefined;
}

export { claudeCodeAdapter } from "./claude-code.js";
