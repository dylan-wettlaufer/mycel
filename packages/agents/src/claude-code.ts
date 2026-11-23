import type { AgentAdapter } from "./index.js";
import { isHookId, isRecord, repoSourcePath, sha256 } from "./evidence.js";

const phases = {
  PreToolUse: "started",
  PostToolUse: "succeeded",
  PostToolUseFailure: "failed",
} as const;

export const claudeCodeAdapter: AgentAdapter = {
  capture(input, projectRoot, receivedAt) {
    if (!isRecord(input)) return [];
    const { hook_event_name: hook, tool_name: tool, tool_input: args } = input;
    if (
      typeof hook !== "string" ||
      !Object.hasOwn(phases, hook) ||
      (tool !== "Edit" && tool !== "Write") ||
      !isHookId(input.session_id) ||
      !isHookId(input.tool_use_id) ||
      !isRecord(args)
    )
      return [];

    const path = repoSourcePath(projectRoot, args.file_path);
    if (!path) return [];

    const phase = phases[hook as keyof typeof phases];
    return [
      {
        provider: "claude-code",
        sessionId: input.session_id,
        toolUseId: input.tool_use_id,
        tool,
        timestamp: receivedAt,
        path,
        phase,
        // The contents submitted to Write are evidence for an exact snapshot match.
        ...(phase === "succeeded" &&
        tool === "Write" &&
        typeof args.content === "string"
          ? {
              expectedHash: sha256(args.content),
            }
          : {}),
      },
    ];
  },
};
