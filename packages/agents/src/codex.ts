import { isAbsolute, resolve } from "node:path";
import type { AgentToolEvent } from "@mycel/shared";
import type { AgentAdapter } from "./index.js";
import {
  isHookId,
  isRecord,
  observedSourceHash,
  repoSourcePath,
  sha256,
} from "./evidence.js";

const successHeader = "Success. Updated the following files:";
const successfulOutputPrefix =
  /^Exit code: 0\r?\nWall time: \d+(?:\.\d+)? seconds\r?\n(?:Total output lines: \d+\r?\n)?Output:\r?\n/;

/** A Codex Add File hunk supplies the complete new file, including its trailing newline. */
function addedHashes(input: unknown, cwd: string): Map<string, string> {
  const hashes = new Map<string, string>();
  if (!isRecord(input) || typeof input.command !== "string") return hashes;
  const patch = input.command.replaceAll("\r\n", "\n");
  for (const [, name, added] of patch.matchAll(
    /^\*\*\* Add File: (.+)\n((?:\+[^\n]*\n)*)/gm,
  )) {
    if (!name || added === undefined) continue;
    hashes.set(resolve(cwd, name), sha256(added.replace(/^\+/gm, "")));
  }
  return hashes;
}

export const codexAdapter: AgentAdapter = {
  projectDirectory(input) {
    if (
      isRecord(input) &&
      typeof input.cwd === "string" &&
      isAbsolute(input.cwd)
    )
      return input.cwd;
  },
  capture(input, projectRoot, receivedAt) {
    if (
      !isRecord(input) ||
      input.hook_event_name !== "PostToolUse" ||
      input.tool_name !== "apply_patch" ||
      !isHookId(input.session_id) ||
      !isHookId(input.tool_use_id) ||
      typeof input.cwd !== "string" ||
      !isAbsolute(input.cwd) ||
      typeof input.tool_response !== "string"
    )
      return [];

    // Codex can wrap the patch summary in its standard command output.
    const output = input.tool_response.replace(successfulOutputPrefix, "");
    const [header, ...lines] = output.split(/\r?\n/);
    if (header !== successHeader) return [];
    const hashes = addedHashes(input.tool_input, input.cwd);
    const events = new Map<string, AgentToolEvent>();
    for (const line of lines) {
      const entry = /^([AMD]) (.+)$/.exec(line);
      if (!entry?.[2]) continue;
      const action = entry[1];
      const absolute = resolve(input.cwd, entry[2]);
      const path = repoSourcePath(projectRoot, absolute);
      if (!path) continue;
      const observedHash =
        action === "D" ? null : observedSourceHash(projectRoot, path);
      if (observedHash === undefined) continue;
      const expectedHash = action === "A" ? hashes.get(absolute) : undefined;
      events.set(path, {
        provider: "codex",
        sessionId: input.session_id,
        toolUseId: sha256(JSON.stringify([input.tool_use_id, path])),
        tool: action === "A" ? "Write" : "Edit",
        timestamp: receivedAt,
        path,
        phase: "observed",
        observedHash,
        ...(expectedHash === undefined ? {} : { expectedHash }),
      });
    }
    return [...events.values()];
  },
};
