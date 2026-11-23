import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { sourceLanguageForPath } from "@mycel/shared";
import type { AgentAdapter } from "./index.js";

const phases = {
  PreToolUse: "started",
  PostToolUse: "succeeded",
  PostToolUseFailure: "failed",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHookId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

/** Resolve existing ancestors so that write hooks can also describe new files. */
function isDirectPath(path: string, root: string): boolean {
  for (let current = path; current !== root; current = dirname(current)) {
    try {
      return realpathSync(current) === current;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        return false;
      }
    }
  }
  return true;
}

export const claudeCodeAdapter: AgentAdapter = {
  capture(input, projectRoot, receivedAt) {
    if (!isRecord(input)) return;
    const { hook_event_name: hook, tool_name: tool, tool_input: args } = input;
    if (
      typeof hook !== "string" ||
      !Object.hasOwn(phases, hook) ||
      (tool !== "Edit" && tool !== "Write") ||
      !isHookId(input.session_id) ||
      !isHookId(input.tool_use_id) ||
      !isRecord(args) ||
      typeof args.file_path !== "string" ||
      !isAbsolute(args.file_path)
    )
      return;

    const absolute = resolve(args.file_path);
    const path = relative(projectRoot, absolute).split(sep).join("/");
    if (
      !path ||
      path === ".." ||
      path.startsWith("../") ||
      isAbsolute(path) ||
      !sourceLanguageForPath(path) ||
      !isDirectPath(absolute, projectRoot)
    )
      return;

    const phase = phases[hook as keyof typeof phases];
    return {
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
            expectedHash: createHash("sha256")
              .update(args.content, "utf8")
              .digest("hex"),
          }
        : {}),
    };
  },
};
