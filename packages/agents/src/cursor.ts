import { randomUUID } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
import type { AgentAdapter } from "./index.js";
import {
  isHookId,
  isRecord,
  observedSourceHash,
  repoSourcePath,
  sha256,
} from "./evidence.js";

export const cursorAdapter: AgentAdapter = {
  projectDirectory(input) {
    if (
      !isRecord(input) ||
      typeof input.file_path !== "string" ||
      !isAbsolute(input.file_path) ||
      !Array.isArray(input.workspace_roots)
    )
      return;
    const file = input.file_path;
    return input.workspace_roots
      .filter((root): root is string => {
        if (typeof root !== "string" || !isAbsolute(root)) return false;
        const path = relative(root, file);
        return (
          Boolean(path) &&
          path !== ".." &&
          !path.startsWith(`..${sep}`) &&
          !isAbsolute(path)
        );
      })
      .sort((a, b) => b.length - a.length)[0];
  },
  capture(input, projectRoot, receivedAt) {
    if (
      !isRecord(input) ||
      input.hook_event_name !== "afterFileEdit" ||
      !isHookId(input.conversation_id)
    )
      return [];
    const path = repoSourcePath(projectRoot, input.file_path);
    if (!path) return [];
    const observedHash = observedSourceHash(projectRoot, path);
    if (!observedHash) return [];
    return [
      {
        provider: "cursor",
        sessionId: input.conversation_id,
        toolUseId: isHookId(input.tool_use_id)
          ? sha256(JSON.stringify([input.tool_use_id, path]))
          : randomUUID(),
        tool: "Edit",
        timestamp: receivedAt,
        path,
        phase: "observed",
        observedHash,
      },
    ];
  },
};
