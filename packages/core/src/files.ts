import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";

/** Read one captured regular file; do not follow source/ignore-file symlinks. */
export async function readRepositoryText(
  root: string,
  path: string,
): Promise<string> {
  const absolutePath = join(root, path);
  if ((await realpath(absolutePath)) !== absolutePath)
    throw new Error(`Source path changed to a symbolic link: ${path}`);
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    if (!(await handle.stat()).isFile())
      throw new Error(`Expected a regular file: ${path}`);
    const content = await handle.readFile();
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      content,
    );
  } finally {
    await handle.close();
  }
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
