import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";

import type { ProjectInfo } from "@mycel/shared";

const execFileAsync = promisify(execFile);

export async function resolveRepository(
  cwd = process.cwd(),
): Promise<ProjectInfo> {
  const directory = await realpath(cwd);
  if (!(await stat(directory)).isDirectory()) {
    throw new Error(`Not a directory: ${directory}`);
  }

  let root = directory;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      {
        cwd: directory,
        timeout: 5000,
        env: { ...process.env, LC_ALL: "C" },
      },
    );
    root = await realpath(stdout.replace(/\r?\n$/, ""));
  } catch (error) {
    // Git is optional; plain folders can also be opened as projects.
    const unavailable =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    const notRepository =
      error instanceof Error &&
      "stderr" in error &&
      typeof error.stderr === "string" &&
      error.stderr.includes("not a git repository");
    if (!unavailable && !notRepository) {
      throw new Error(`Could not resolve repository at ${directory}`, {
        cause: error,
      });
    }
  }

  return { name: basename(root) || root, root };
}
