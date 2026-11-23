import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { sourceLanguageForPath } from "@mycel/shared";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isHookId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Validate existing ancestors as well as the file so additions and removals work. */
export function repoSourcePath(
  root: string,
  value: unknown,
): string | undefined {
  if (typeof value !== "string" || !isAbsolute(value)) return;
  const absolute = resolve(value);
  const path = relative(root, absolute).split(sep).join("/");
  if (
    !path ||
    path === ".." ||
    path.startsWith("../") ||
    isAbsolute(path) ||
    !sourceLanguageForPath(path)
  )
    return;
  for (let current = absolute; current !== root; current = dirname(current)) {
    try {
      if (realpathSync(current) === current) return path;
      return;
    } catch (error) {
      if (
        !isMissing(error) ||
        lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()
      )
        return;
    }
  }
  return path;
}

/** Match the captured bytes to an indexed snapshot without keeping the source. */
export function observedSourceHash(
  root: string,
  path: string,
): string | undefined {
  try {
    const fd = openSync(
      join(root, path),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = fstatSync(fd);
      if (stat.isFile() && stat.size <= 32 * 1024 * 1024)
        return sha256(readFileSync(fd));
    } finally {
      closeSync(fd);
    }
  } catch {
    // A missing or replaced source file is insufficient evidence for a write.
  }
}
